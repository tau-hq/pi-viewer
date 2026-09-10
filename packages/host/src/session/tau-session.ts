import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { TAU_REPLY_KEY } from "@pi-tau/pi-extension";
import type {
	ApprovalMode,
	AssistantMessage,
	CommandInfo,
	ContentBlock,
	ImageInput,
	Message,
	ModelInfo,
	SessionCommand,
	SessionEvent,
	SessionSnapshot,
	SessionState,
	ThinkingLevel,
	ToolRun,
	TreeNode,
	UiRequest,
	UiResponse,
	Widget,
} from "@pi-tau/shared";
import { createLogger } from "../logger.js";
import { RpcError, RpcProcess } from "../pi/rpc-process.js";
import type {
	PiEntry,
	PiEvent,
	PiExtensionError,
	PiExtensionUiRequest,
	PiMessage,
	PiModel,
	PiSessionState,
	PiSessionStats,
	PiToolResultMessage,
	PiTreeNode,
} from "../pi/rpc-types.js";
import { autoRetryEnabled } from "../pi-sdk.js";
import {
	entriesToTranscript,
	toForkMessages,
	toMessage,
	toModelInfo,
	toSessionState,
	toSessionStats,
	toStopReason,
	toThinkingLevel,
	toToolResultMessage,
	toTree,
	toUsage,
} from "./translate.js";

const log = createLogger("session");
const RING_SIZE = 5_000;
const LONG_TIMEOUT_MS = 10 * 60_000;

export interface TauSessionOptions {
	/** Stable host handle for this session (first pi session id). */
	handle: string;
	cwd: string;
	args: string[];
	idleTimeoutMs: number;
	piBinary?: string;
	/** True when pi was started with --no-session, so nothing is written to disk. */
	ephemeral?: boolean;
}

export interface SeqEvent {
	seq: number;
	event: SessionEvent;
}

/**
 * One pi process plus the replicated state clients see. Emits:
 *  - "event" (SeqEvent) for every translated event
 *  - "snapshot" when the whole snapshot should be resent
 *  - "exit" when the pi process is gone
 */
export class TauSession extends EventEmitter {
	readonly handle: string;
	readonly cwd: string;
	readonly startedAt = Date.now();
	readonly ephemeral: boolean;
	private readonly rpc: RpcProcess;
	private readonly idleTimeoutMs: number;
	private seq = 0;
	private readonly ring: SeqEvent[] = [];
	private state: SessionState;
	private messages: Message[] = [];
	private leafId: string | undefined;
	private streaming: AssistantMessage | undefined;
	private queue: { steering: string[]; followUp: string[] } = { steering: [], followUp: [] };
	private readonly activeTools = new Map<string, ToolRun>();
	private readonly statuses = new Map<string, string>();
	private readonly widgets = new Map<string, Widget>();
	private readonly pendingUi = new Map<string, UiRequest>();
	private stats: SessionSnapshot["stats"] | undefined;
	private retry: SessionSnapshot["retry"] | undefined;
	private entriesCache: PiEntry[] = [];
	private liveCounter = 0;
	private subscribers = 0;
	private idleTimer: NodeJS.Timeout | undefined;
	private lastActivity = Date.now();
	private rebuildQueued = false;
	private closed = false;
	private readonly entryWaiters = new Map<
		string,
		{ resolve: (data: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
	>();

	constructor(options: TauSessionOptions, rpc?: RpcProcess) {
		super();
		this.handle = options.handle;
		this.cwd = options.cwd;
		this.idleTimeoutMs = options.idleTimeoutMs;
		this.ephemeral = options.ephemeral === true;
		this.rpc = rpc ?? new RpcProcess(rpcOptions(options));
		this.state = {
			sessionId: options.handle,
			cwd: options.cwd,
			thinkingLevel: "off",
			isStreaming: false,
			isCompacting: false,
			steeringMode: "one-at-a-time",
			followUpMode: "one-at-a-time",
			autoCompactionEnabled: true,
			autoRetryEnabled: true,
			messageCount: 0,
			pendingMessageCount: 0,
			processAlive: false,
		};
	}

	/** Spawn pi, then load state and transcript. */
	static async start(options: Omit<TauSessionOptions, "handle"> & { handle?: string }): Promise<TauSession> {
		const rpc = new RpcProcess(rpcOptions(options));
		rpc.start();
		let piState: PiSessionState;
		try {
			piState = await rpc.request<PiSessionState>({ type: "get_state" }, 60_000);
		} catch (error) {
			await rpc.stop(1_000);
			throw new Error(
				`pi did not answer get_state: ${(error as Error).message}. stderr: ${rpc.lastStderr.slice(-800)}`,
			);
		}
		const session = new TauSession({ ...options, handle: options.handle ?? piState.sessionId }, rpc);
		session.adopt(piState);
		await session.rebuild();
		// Ask Tau's extension for its approval mode; without the extension it stays undefined.
		try {
			const data = (await session.extensionCall("tau-approval", "tau.approval", "", 8_000)) as { mode?: string };
			if (typeof data.mode === "string") session.patchState({ approvalMode: data.mode as ApprovalMode });
		} catch {
			// no Tau extension in this session
		}
		return session;
	}

	private adopt(piState: PiSessionState): void {
		const rpc = this.rpc;
		this.state = toSessionState(piState, this.cwd, true, autoRetryEnabled(this.cwd));
		rpc.on("event", (event: PiEvent) => this.onPiEvent(event));
		rpc.on("ui", (request: PiExtensionUiRequest) => this.onUiRequest(request));
		rpc.on("extensionError", (error: PiExtensionError) => {
			this.push({ type: "notify", message: `Extension error: ${error.error}`, level: "error" });
		});
		rpc.on("exit", (code: number | null, signal: string | null) => {
			this.state = { ...this.state, processAlive: false, isStreaming: false };
			const event: SessionEvent = { type: "process.exit", code };
			if (signal) event.signal = signal;
			this.push(event);
			this.push({ type: "state.update", state: { processAlive: false, isStreaming: false } });
			this.emit("exit");
		});
		this.armIdleTimer();
	}

	get alive(): boolean {
		return this.rpc.alive;
	}

	get sessionFile(): string | undefined {
		return this.state.sessionFile;
	}

	get piSessionId(): string {
		return this.state.sessionId;
	}

	get isStreaming(): boolean {
		return this.state.isStreaming;
	}

	get currentSeq(): number {
		return this.seq;
	}

	get subscriberCount(): number {
		return this.subscribers;
	}

	addSubscriber(): void {
		this.subscribers++;
		this.touch();
	}

	removeSubscriber(): void {
		this.subscribers = Math.max(0, this.subscribers - 1);
		this.armIdleTimer();
	}

	/** Events after `afterSeq`, or undefined when they fell out of the ring buffer. */
	eventsAfter(afterSeq: number): SeqEvent[] | undefined {
		if (afterSeq >= this.seq) return [];
		const first = this.ring[0];
		if (!first || first.seq > afterSeq + 1) return undefined;
		return this.ring.filter((e) => e.seq > afterSeq);
	}

	snapshot(): SessionSnapshot {
		const snap: SessionSnapshot = {
			state: { ...this.state },
			messages: this.messages,
			queue: { steering: [...this.queue.steering], followUp: [...this.queue.followUp] },
			activeTools: [...this.activeTools.values()],
			statuses: Object.fromEntries(this.statuses),
			widgets: Object.fromEntries(this.widgets),
			pendingUi: [...this.pendingUi.values()],
		};
		if (this.leafId !== undefined) snap.leafId = this.leafId;
		if (this.streaming) snap.streaming = this.streaming;
		if (this.stats) snap.stats = this.stats;
		if (this.retry) snap.retry = this.retry;
		return snap;
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		if (this.idleTimer) clearTimeout(this.idleTimer);
		await this.rpc.stop();
	}

	// ---------------------------------------------------------------- commands

	async execute(command: SessionCommand): Promise<unknown> {
		this.touch();
		switch (command.type) {
			case "prompt": {
				const cmd: Parameters<RpcProcess["request"]>[0] = { type: "prompt", message: command.message };
				const images = toPiImages(command.images);
				if (images) cmd.images = images;
				if (command.streamingBehavior) cmd.streamingBehavior = command.streamingBehavior;
				else if (this.state.isStreaming) cmd.streamingBehavior = "steer";
				return this.rpc.request(cmd, LONG_TIMEOUT_MS);
			}
			case "steer": {
				const cmd: Parameters<RpcProcess["request"]>[0] = { type: "steer", message: command.message };
				const images = toPiImages(command.images);
				if (images) cmd.images = images;
				return this.rpc.request(cmd);
			}
			case "followUp": {
				const cmd: Parameters<RpcProcess["request"]>[0] = { type: "follow_up", message: command.message };
				const images = toPiImages(command.images);
				if (images) cmd.images = images;
				return this.rpc.request(cmd);
			}
			case "abort":
				return this.rpc.request({ type: "abort" }, 60_000);
			case "clearQueue":
				return this.rpc.request({ type: "clear_queue" });
			case "setModel": {
				const model = await this.rpc.request<PiModel>({
					type: "set_model",
					provider: command.provider,
					modelId: command.modelId,
				});
				const info = toModelInfo(model);
				this.patchState({ model: info });
				await this.refreshState();
				return info;
			}
			case "cycleModel": {
				const result = await this.rpc.request<{ model: PiModel; thinkingLevel: string } | null>({
					type: "cycle_model",
				});
				if (result)
					this.patchState({ model: toModelInfo(result.model), thinkingLevel: toThinkingLevel(result.thinkingLevel) });
				return result ? toModelInfo(result.model) : null;
			}
			case "setThinkingLevel":
				await this.rpc.request({ type: "set_thinking_level", level: command.level });
				this.patchState({ thinkingLevel: command.level });
				return null;
			case "getThinkingLevels": {
				const data = await this.rpc.request<{ levels: string[] }>({ type: "get_available_thinking_levels" });
				return data.levels.map(toThinkingLevel);
			}
			case "setSteeringMode":
				await this.rpc.request({ type: "set_steering_mode", mode: command.mode });
				this.patchState({ steeringMode: command.mode });
				return null;
			case "setFollowUpMode":
				await this.rpc.request({ type: "set_follow_up_mode", mode: command.mode });
				this.patchState({ followUpMode: command.mode });
				return null;
			case "compact": {
				const cmd: Parameters<RpcProcess["request"]>[0] = { type: "compact" };
				if (command.customInstructions) cmd.customInstructions = command.customInstructions;
				const result = await this.rpc.request(cmd, LONG_TIMEOUT_MS);
				this.queueRebuild();
				return result;
			}
			case "setApprovalMode": {
				await this.extensionCall("tau-approval", "tau.approval", command.mode);
				this.patchState({ approvalMode: command.mode });
				return null;
			}
			case "setAutoCompaction":
				await this.rpc.request({ type: "set_auto_compaction", enabled: command.enabled });
				this.patchState({ autoCompactionEnabled: command.enabled });
				return null;
			case "setAutoRetry":
				await this.rpc.request({ type: "set_auto_retry", enabled: command.enabled });
				this.patchState({ autoRetryEnabled: command.enabled });
				return null;
			case "abortRetry":
				return this.rpc.request({ type: "abort_retry" });
			case "bash": {
				const cmd: Parameters<RpcProcess["request"]>[0] = { type: "bash", command: command.command };
				if (command.excludeFromContext) cmd.excludeFromContext = true;
				const result = await this.rpc.request(cmd, LONG_TIMEOUT_MS);
				this.queueRebuild();
				return result;
			}
			case "abortBash":
				return this.rpc.request({ type: "abort_bash" });
			case "getStats":
				return this.refreshStats();
			case "exportHtml": {
				const cmd: Parameters<RpcProcess["request"]>[0] = { type: "export_html" };
				if (command.outputPath) cmd.outputPath = command.outputPath;
				return this.rpc.request(cmd, 120_000);
			}
			case "fork": {
				const result = await this.rpc.request<{ text: string; cancelled: boolean }>(
					{ type: "fork", entryId: command.entryId },
					60_000,
				);
				await this.refreshState();
				await this.rebuild();
				this.emit("changed");
				return result;
			}
			case "clone": {
				const result = await this.rpc.request<{ cancelled: boolean }>({ type: "clone" }, 60_000);
				await this.refreshState();
				await this.rebuild();
				this.emit("changed");
				return result;
			}
			case "getForkMessages": {
				const data = await this.rpc.request<{ messages: { entryId: string; text: string }[] }>({
					type: "get_fork_messages",
				});
				return toForkMessages(data.messages, this.entriesCache);
			}
			case "getTree": {
				const data = await this.rpc.request<{ tree: PiTreeNode[]; leafId: string | null }>({ type: "get_tree" });
				const tree: TreeNode[] = toTree(data.tree, data.leafId);
				return { tree, leafId: data.leafId };
			}
			case "setName":
				// pi answers with session_info_changed, which updates state and the session list.
				await this.rpc.request({ type: "set_session_name", name: command.name });
				return null;
			case "getCommands": {
				const data = await this.rpc.request<{
					commands: {
						name: string;
						description?: string;
						source: CommandInfo["source"];
						sourceInfo?: { scope?: string };
					}[];
				}>({ type: "get_commands" });
				return data.commands.map((c) => {
					const info: CommandInfo = { name: c.name, source: c.source };
					if (c.description !== undefined) info.description = c.description;
					if (c.sourceInfo?.scope !== undefined) info.scope = c.sourceInfo.scope;
					return info;
				});
			}
			case "getModels": {
				const data = await this.rpc.request<{ models: PiModel[] }>({ type: "get_available_models" }, 60_000);
				return data.models.map(toModelInfo) satisfies ModelInfo[];
			}
			case "ui.response":
				return this.respondUi(command.response);
			case "refresh":
				await this.refreshState();
				await this.rebuild();
				return null;
			case "tools.list":
				return this.extensionCall("tau-tools", "tau.tools", "list");
			case "tools.set":
				return this.extensionCall("tau-tools", "tau.tools", `set ${command.names.join(",")}`);
			case "reloadResources": {
				await this.rpc.request({ type: "prompt", message: "/tau-reload" }, 120_000);
				await this.refreshState();
				return null;
			}
			case "navigateTree": {
				await this.rpc.request(
					{ type: "prompt", message: `/tau-tree ${command.entryId}${command.summarize ? " --summarize" : ""}` },
					LONG_TIMEOUT_MS,
				);
				await this.refreshState();
				await this.rebuild();
				return null;
			}
			default: {
				const unknown: never = command;
				throw new RpcError("unknown", `unknown session command ${(unknown as { type?: string }).type}`);
			}
		}
	}

	/** Resolve the waiter for a reply the Tau extension sent through its reserved status key. */
	private resolveExtensionReply(payload: string): void {
		let data: { channel?: string; requestId?: string };
		try {
			data = JSON.parse(payload) as typeof data;
		} catch {
			log.warn("extension reply is not JSON");
			return;
		}
		const waiter = data.requestId ? this.entryWaiters.get(data.requestId) : undefined;
		if (!waiter) return;
		clearTimeout(waiter.timer);
		this.entryWaiters.delete(data.requestId as string);
		waiter.resolve(data);
	}

	/** Invoke a Tau extension command and wait for its reply on the reserved status key. */
	async extensionCall(command: string, replyType: string, args: string, timeoutMs = 20_000): Promise<unknown> {
		const requestId = randomUUID();
		const reply = new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.entryWaiters.delete(requestId);
				reject(new RpcError("extension", `no reply from /${command}; is the Tau extension loaded?`));
			}, timeoutMs);
			this.entryWaiters.set(requestId, { resolve, reject, timer });
		});
		const cmd: Parameters<RpcProcess["request"]>[0] = { type: "prompt", message: `/${command} ${requestId} ${args}` };
		if (this.state.isStreaming) cmd.streamingBehavior = "steer";
		await this.rpc.request(cmd, LONG_TIMEOUT_MS);
		const data = (await reply) as Record<string, unknown>;
		if (replyType === "tau.tools") return { tools: data.tools, active: data.active };
		if (replyType === "tau.approval") return { mode: data.mode };
		return data;
	}

	private respondUi(response: UiResponse): null {
		if (!this.pendingUi.has(response.id)) throw new RpcError("ui.response", "no pending request with that id");
		if ("cancelled" in response)
			this.rpc.respondUi({ type: "extension_ui_response", id: response.id, cancelled: true });
		else if ("confirmed" in response)
			this.rpc.respondUi({ type: "extension_ui_response", id: response.id, confirmed: response.confirmed });
		else this.rpc.respondUi({ type: "extension_ui_response", id: response.id, value: response.value });
		this.pendingUi.delete(response.id);
		this.push({ type: "ui.resolved", requestId: response.id });
		return null;
	}

	// ------------------------------------------------------------ state sync

	async refreshState(): Promise<void> {
		const piState = await this.rpc.request<PiSessionState>({ type: "get_state" });
		const next = toSessionState(piState, this.cwd, this.rpc.alive, this.state.autoRetryEnabled);
		const changed: Partial<SessionState> = {};
		for (const key of Object.keys(next) as (keyof SessionState)[]) {
			if (JSON.stringify(next[key]) !== JSON.stringify(this.state[key]))
				(changed as Record<string, unknown>)[key] = next[key];
		}
		this.state = next;
		if (Object.keys(changed).length > 0) this.push({ type: "state.update", state: changed });
	}

	async refreshStats(): Promise<SessionSnapshot["stats"]> {
		const pi = await this.rpc.request<PiSessionStats>({ type: "get_session_stats" });
		this.stats = toSessionStats(pi);
		this.push({ type: "stats.update", stats: this.stats });
		return this.stats;
	}

	/** Reload the transcript from pi's entries (authoritative ids). */
	async rebuild(): Promise<void> {
		const data = await this.rpc.request<{ entries: PiEntry[]; leafId: string | null }>({ type: "get_entries" }, 60_000);
		this.entriesCache = data.entries;
		this.messages = entriesToTranscript(data.entries, data.leafId);
		this.leafId = data.leafId ?? undefined;
		const event: SessionEvent = { type: "transcript.replace", messages: this.messages };
		if (this.leafId !== undefined) event.leafId = this.leafId;
		this.push(event);
	}

	private queueRebuild(): void {
		if (this.rebuildQueued) return;
		this.rebuildQueued = true;
		setTimeout(() => {
			this.rebuildQueued = false;
			if (!this.rpc.alive) return;
			this.rebuild().catch((error) => log.warn(`rebuild failed: ${(error as Error).message}`));
			this.refreshStats().catch(() => undefined);
		}, 50);
	}

	patchState(patch: Partial<SessionState>): void {
		this.state = { ...this.state, ...patch };
		this.push({ type: "state.update", state: patch });
	}

	private push(event: SessionEvent): void {
		this.seq++;
		const entry: SeqEvent = { seq: this.seq, event };
		this.ring.push(entry);
		if (this.ring.length > RING_SIZE) this.ring.shift();
		this.emit("event", entry);
	}

	private touch(): void {
		this.lastActivity = Date.now();
		this.armIdleTimer();
	}

	private armIdleTimer(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		if (this.idleTimeoutMs <= 0) return;
		this.idleTimer = setTimeout(() => {
			if (this.subscribers > 0 || this.state.isStreaming || this.closed) {
				this.armIdleTimer();
				return;
			}
			log.info(`session ${this.handle} idle for ${Math.round((Date.now() - this.lastActivity) / 1000)}s, stopping pi`);
			this.close().then(() => this.emit("idle"));
		}, this.idleTimeoutMs);
		this.idleTimer.unref();
	}

	// ------------------------------------------------------- pi event mapping

	private newLiveId(): string {
		this.liveCounter++;
		return `live-${this.handle.slice(0, 8)}-${this.liveCounter}`;
	}

	private onPiEvent(event: PiEvent): void {
		this.lastActivity = Date.now();
		switch (event.type) {
			case "agent_start":
				this.patchState({ isStreaming: true });
				this.push({ type: "run.start" });
				return;
			case "agent_end":
				this.push({ type: "run.end", willRetry: (event as { willRetry: boolean }).willRetry === true });
				return;
			case "agent_settled":
				this.streaming = undefined;
				this.activeTools.clear();
				this.retry = undefined;
				this.patchState({ isStreaming: false });
				this.push({ type: "run.settled" });
				this.queueRebuild();
				this.refreshState().catch(() => undefined);
				return;
			case "turn_start":
				this.push({ type: "turn.start" });
				return;
			case "turn_end":
				this.push({ type: "turn.end" });
				return;
			case "message_start":
				this.onMessageStart((event as { message: PiMessage }).message);
				return;
			case "message_update":
				this.onMessageUpdate((event as Extract<PiEvent, { type: "message_update" }>).assistantMessageEvent);
				return;
			case "message_end":
				this.onMessageEnd((event as { message: PiMessage }).message);
				return;
			case "tool_execution_start": {
				const e = event as Extract<PiEvent, { type: "tool_execution_start" }>;
				const run: ToolRun = { toolCallId: e.toolCallId, toolName: e.toolName, args: e.args, startedAt: Date.now() };
				this.activeTools.set(e.toolCallId, run);
				this.push({ type: "tool.start", run });
				return;
			}
			case "tool_execution_update": {
				const e = event as Extract<PiEvent, { type: "tool_execution_update" }>;
				const run = this.activeTools.get(e.toolCallId);
				if (run) run.partial = e.partialResult;
				this.push({ type: "tool.update", toolCallId: e.toolCallId, partial: e.partialResult });
				return;
			}
			case "tool_execution_end": {
				const e = event as Extract<PiEvent, { type: "tool_execution_end" }>;
				this.activeTools.delete(e.toolCallId);
				const raw = (e.result ?? {}) as { content?: PiToolResultMessage["content"]; details?: unknown };
				const result = toToolResultMessage(this.newLiveId(), {
					role: "toolResult",
					toolCallId: e.toolCallId,
					toolName: e.toolName,
					content: raw.content ?? [],
					details: raw.details,
					isError: e.isError,
					timestamp: Date.now(),
				});
				this.push({ type: "tool.end", toolCallId: e.toolCallId, result });
				return;
			}
			case "queue_update": {
				const e = event as Extract<PiEvent, { type: "queue_update" }>;
				this.queue = { steering: [...e.steering], followUp: [...e.followUp] };
				this.patchState({ pendingMessageCount: this.queue.steering.length + this.queue.followUp.length });
				this.push({ type: "queue.update", steering: this.queue.steering, followUp: this.queue.followUp });
				return;
			}
			case "compaction_start":
				this.patchState({ isCompacting: true });
				this.push({
					type: "compaction.start",
					reason: (event as { reason: "manual" | "threshold" | "overflow" }).reason,
				});
				return;
			case "compaction_end": {
				const e = event as Extract<PiEvent, { type: "compaction_end" }>;
				this.patchState({ isCompacting: false });
				const out: SessionEvent = { type: "compaction.end", reason: e.reason, aborted: e.aborted };
				if (e.errorMessage !== undefined) out.errorMessage = e.errorMessage;
				if (e.result?.summary !== undefined) out.summary = e.result.summary;
				this.push(out);
				this.queueRebuild();
				return;
			}
			case "auto_retry_start": {
				const e = event as Extract<PiEvent, { type: "auto_retry_start" }>;
				this.retry = {
					attempt: e.attempt,
					maxAttempts: e.maxAttempts,
					delayMs: e.delayMs,
					errorMessage: e.errorMessage,
				};
				this.push({ type: "retry.start", ...this.retry });
				return;
			}
			case "auto_retry_end": {
				const e = event as Extract<PiEvent, { type: "auto_retry_end" }>;
				this.retry = undefined;
				const out: SessionEvent = { type: "retry.end", success: e.success, attempt: e.attempt };
				if (e.finalError !== undefined) out.finalError = e.finalError;
				this.push(out);
				return;
			}
			case "bash_execution_update": {
				const e = event as Extract<PiEvent, { type: "bash_execution_update" }>;
				this.push({ type: "bash.output", commandId: e.id ?? "", delta: e.delta });
				return;
			}
			case "session_info_changed": {
				const name = (event as { name: string | undefined }).name;
				const patch: Partial<SessionState> = {};
				if (name !== undefined) patch.sessionName = name;
				this.state = { ...this.state, ...patch };
				this.push({ type: "state.update", state: patch });
				this.emit("changed");
				return;
			}
			case "thinking_level_changed":
				this.patchState({ thinkingLevel: toThinkingLevel((event as { level: string }).level) });
				return;
			case "entry_appended": {
				const entry = (event as { entry: PiEntry }).entry;
				// Sessions written by older Tau versions still carry these bookkeeping entries.
				if (entry.type === "custom" && typeof entry.customType === "string" && entry.customType.startsWith("tau."))
					return;
				this.queueRebuild();
				return;
			}
			default:
				log.debug(`unhandled pi event ${event.type}`);
		}
	}

	private onMessageStart(message: PiMessage): void {
		if (message.role === "assistant") {
			const id = this.newLiveId();
			this.streaming = {
				role: "assistant",
				id,
				content: [],
				provider: message.provider,
				model: message.model,
				usage: toUsage(message.usage),
				stopReason: toStopReason(message.stopReason),
				timestamp: message.timestamp ?? Date.now(),
			};
			this.push({ type: "message.start", message: this.streaming });
			return;
		}
		// Every other role arrives complete through message.end (and tool results also via tool.end).
	}

	private onMessageUpdate(ev: Extract<PiEvent, { type: "message_update" }>["assistantMessageEvent"]): void {
		const streaming = this.streaming;
		if (!streaming) return;
		const messageId = streaming.id;
		const ensureBlock = (index: number, block: ContentBlock): ContentBlock => {
			while (streaming.content.length <= index) streaming.content.push({ type: "text", text: "" });
			streaming.content[index] = block;
			return block;
		};
		switch (ev.type) {
			case "text_start":
				this.push({
					type: "block.start",
					messageId,
					contentIndex: ev.contentIndex,
					block: ensureBlock(ev.contentIndex, { type: "text", text: "" }),
				});
				return;
			case "text_delta": {
				const block = streaming.content[ev.contentIndex];
				if (block?.type === "text") block.text += ev.delta;
				this.push({ type: "block.delta", messageId, contentIndex: ev.contentIndex, kind: "text", delta: ev.delta });
				return;
			}
			case "text_end":
				this.push({
					type: "block.end",
					messageId,
					contentIndex: ev.contentIndex,
					block: ensureBlock(ev.contentIndex, { type: "text", text: ev.content }),
				});
				return;
			case "thinking_start":
				this.push({
					type: "block.start",
					messageId,
					contentIndex: ev.contentIndex,
					block: ensureBlock(ev.contentIndex, { type: "thinking", thinking: "" }),
				});
				return;
			case "thinking_delta": {
				const block = streaming.content[ev.contentIndex];
				if (block?.type === "thinking") block.thinking += ev.delta;
				this.push({ type: "block.delta", messageId, contentIndex: ev.contentIndex, kind: "thinking", delta: ev.delta });
				return;
			}
			case "thinking_end":
				this.push({
					type: "block.end",
					messageId,
					contentIndex: ev.contentIndex,
					block: ensureBlock(ev.contentIndex, { type: "thinking", thinking: ev.content }),
				});
				return;
			case "toolcall_start":
				this.push({
					type: "block.start",
					messageId,
					contentIndex: ev.contentIndex,
					block: ensureBlock(ev.contentIndex, {
						type: "toolCall",
						id: ev.id,
						name: ev.toolName,
						arguments: {},
						partialJson: "",
					}),
				});
				return;
			case "toolcall_delta": {
				const block = streaming.content[ev.contentIndex];
				if (block?.type === "toolCall") block.partialJson = (block.partialJson ?? "") + ev.delta;
				this.push({ type: "block.delta", messageId, contentIndex: ev.contentIndex, kind: "toolArgs", delta: ev.delta });
				return;
			}
			case "toolcall_end":
				this.push({
					type: "block.end",
					messageId,
					contentIndex: ev.contentIndex,
					block: ensureBlock(ev.contentIndex, {
						type: "toolCall",
						id: ev.toolCall.id,
						name: ev.toolCall.name,
						arguments: ev.toolCall.arguments,
					}),
				});
				return;
			default:
				return;
		}
	}

	private onMessageEnd(message: PiMessage): void {
		if (message.role === "assistant") {
			const id = this.streaming?.id ?? this.newLiveId();
			const final = toMessage(id, message) as AssistantMessage;
			this.streaming = undefined;
			this.messages = [...this.messages, final];
			this.push({ type: "message.end", message: final });
			return;
		}
		if (message.role === "toolResult") {
			const m = toToolResultMessage(this.newLiveId(), message);
			this.messages = [...this.messages, m];
			this.push({ type: "message.end", message: m });
			return;
		}
		const m = toMessage(this.newLiveId(), message);
		if (!m) return;
		this.messages = [...this.messages, m];
		this.push({ type: "message.end", message: m });
	}

	private onUiRequest(request: PiExtensionUiRequest): void {
		switch (request.method) {
			case "select":
			case "confirm":
			case "input":
			case "editor": {
				const ui = toUiRequest(request);
				this.pendingUi.set(ui.id, ui);
				this.push({ type: "ui.request", request: ui });
				return;
			}
			case "notify":
				this.push({ type: "notify", message: request.message, level: request.notifyType ?? "info" });
				return;
			case "setStatus": {
				// Tau's extension answers through this reserved key instead of writing an entry.
				if (request.statusKey === TAU_REPLY_KEY) {
					if (request.statusText) this.resolveExtensionReply(request.statusText);
					return;
				}
				if (request.statusText === undefined || request.statusText === "") this.statuses.delete(request.statusKey);
				else this.statuses.set(request.statusKey, request.statusText);
				const out: SessionEvent = { type: "status.set", key: request.statusKey };
				if (request.statusText !== undefined) out.text = request.statusText;
				this.push(out);
				return;
			}
			case "setWidget": {
				const out: SessionEvent = { type: "widget.set", key: request.widgetKey };
				if (request.widgetLines && request.widgetLines.length > 0) {
					const widget: Widget = { lines: request.widgetLines, placement: request.widgetPlacement ?? "belowEditor" };
					this.widgets.set(request.widgetKey, widget);
					out.widget = widget;
				} else this.widgets.delete(request.widgetKey);
				this.push(out);
				return;
			}
			case "setTitle":
				this.push({ type: "title.set", title: request.title });
				return;
			case "set_editor_text":
				this.push({ type: "editor.set", text: request.text });
				return;
			default:
				return;
		}
	}
}

function rpcOptions(
	options: Pick<TauSessionOptions, "cwd" | "args" | "piBinary">,
): ConstructorParameters<typeof RpcProcess>[0] {
	const out: ConstructorParameters<typeof RpcProcess>[0] = { cwd: options.cwd, args: options.args };
	if (options.piBinary) out.piBinary = options.piBinary;
	return out;
}

function toPiImages(images: ImageInput[] | undefined): { type: "image"; data: string; mimeType: string }[] | undefined {
	if (!images || images.length === 0) return undefined;
	return images.map((i) => ({ type: "image", data: i.data, mimeType: i.mimeType }));
}

function toUiRequest(
	request: Extract<PiExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>,
): UiRequest {
	switch (request.method) {
		case "select": {
			const out: UiRequest = { id: request.id, method: "select", title: request.title, options: request.options };
			if (request.timeout !== undefined) out.timeoutMs = request.timeout;
			return out;
		}
		case "confirm": {
			const out: UiRequest = { id: request.id, method: "confirm", title: request.title, message: request.message };
			if (request.timeout !== undefined) out.timeoutMs = request.timeout;
			return out;
		}
		case "input": {
			const out: UiRequest = { id: request.id, method: "input", title: request.title };
			if (request.placeholder !== undefined) out.placeholder = request.placeholder;
			if (request.timeout !== undefined) out.timeoutMs = request.timeout;
			return out;
		}
		case "editor": {
			const out: UiRequest = { id: request.id, method: "editor", title: request.title };
			if (request.prefill !== undefined) out.prefill = request.prefill;
			return out;
		}
	}
}

export type { ThinkingLevel };

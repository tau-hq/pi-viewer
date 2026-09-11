import type {
	AssistantMessage,
	ContentBlock,
	Message,
	SessionEvent,
	SessionSnapshot,
	SessionState,
	SessionStats,
	ToolResultMessage,
	ToolRun,
	UiRequest,
	Widget,
} from "@pi-tau/shared";
import { messageText } from "../lib/messages";

export interface RetryInfo {
	attempt: number;
	maxAttempts: number;
	delayMs: number;
	errorMessage: string;
}

export interface BashResult {
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
}

/**
 * A `!` command run from this client. Output streams in via bash.output; once the command
 * answers, `result` holds the final state and the card stays until the host's durable
 * bashExecution message replaces it (transcript.replace) or the run is dropped.
 */
export interface BashRun {
	commandId: string;
	command: string | undefined;
	output: string;
	startedAt: number;
	result?: BashResult;
}

/** Client-side view of one session: the snapshot plus everything derived from events. */
export interface SessionView {
	sessionId: string;
	/** True once a snapshot has been applied. */
	loaded: boolean;
	/**
	 * The conversation is on screen straight from the session file while pi is still starting.
	 * Everything is readable, nothing can be sent yet, and the snapshot replaces it shortly.
	 */
	attaching: boolean;
	lastSeq: number;
	state: SessionState;
	messages: Message[];
	leafId: string | undefined;
	streaming: AssistantMessage | undefined;
	queue: { steering: string[]; followUp: string[] };
	activeTools: ToolRun[];
	/** Tool results indexed by toolCallId, kept in sync with `messages`. */
	toolResults: Record<string, ToolResultMessage>;
	statuses: Record<string, string>;
	widgets: Record<string, Widget>;
	pendingUi: UiRequest[];
	stats: SessionStats | undefined;
	retry: RetryInfo | undefined;
	compaction: { reason: "manual" | "threshold" | "overflow" } | undefined;
	/** True between run.start and run.settled (or process exit). */
	runActive: boolean;
	/** Output of a `!` command that is still running. */
	bashRun: BashRun | undefined;
	title: string | undefined;
	/** Text an extension asked to put into the composer; nonce changes per request. */
	editorRequest: { text: string; nonce: number } | undefined;
	processExit: { code: number | null; signal: string | undefined } | undefined;
	lastError: string | undefined;
}

function emptySessionState(sessionId: string): SessionState {
	return {
		sessionId,
		cwd: "",
		thinkingLevel: "off",
		isStreaming: false,
		isCompacting: false,
		steeringMode: "one-at-a-time",
		followUpMode: "one-at-a-time",
		autoCompactionEnabled: true,
		autoRetryEnabled: true,
		needsInput: false,
		bashRunning: false,
		lastRunFailed: false,
		messageCount: 0,
		pendingMessageCount: 0,
		processAlive: false,
	};
}

export function createSessionView(sessionId: string): SessionView {
	return {
		sessionId,
		loaded: false,
		attaching: false,
		lastSeq: -1,
		state: emptySessionState(sessionId),
		messages: [],
		leafId: undefined,
		streaming: undefined,
		queue: { steering: [], followUp: [] },
		activeTools: [],
		toolResults: {},
		statuses: {},
		widgets: {},
		pendingUi: [],
		stats: undefined,
		retry: undefined,
		compaction: undefined,
		runActive: false,
		bashRun: undefined,
		title: undefined,
		editorRequest: undefined,
		processExit: undefined,
		lastError: undefined,
	};
}

export function applySnapshot(previous: SessionView | undefined, seq: number, snapshot: SessionSnapshot): SessionView {
	const base = previous ?? createSessionView(snapshot.state.sessionId);
	return {
		...base,
		loaded: true,
		attaching: false,
		lastSeq: seq,
		state: snapshot.state,
		messages: snapshot.messages,
		leafId: snapshot.leafId,
		streaming: snapshot.streaming,
		queue: snapshot.queue,
		activeTools: snapshot.activeTools,
		toolResults: indexToolResults(snapshot.messages),
		statuses: snapshot.statuses,
		widgets: snapshot.widgets,
		pendingUi: snapshot.pendingUi,
		stats: snapshot.stats,
		retry: snapshot.retry,
		runActive: snapshot.state.isStreaming,
		bashRun: undefined,
		processExit: snapshot.state.processAlive ? undefined : base.processExit,
	};
}

export function indexToolResults(messages: readonly Message[]): Record<string, ToolResultMessage> {
	const index: Record<string, ToolResultMessage> = {};
	for (const message of messages) {
		if (message.role === "toolResult") index[message.toolCallId] = message;
	}
	return index;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function sameMessage(a: Message, b: Message): boolean {
	if (a.role !== b.role) return false;
	if (a.id === b.id) return true;
	if (a.role === "toolResult" && b.role === "toolResult") return a.toolCallId === b.toolCallId;
	return a.timestamp === b.timestamp && messageText(a) === messageText(b);
}

/** Replace an existing copy of the message (searching from the end) or append it. */
function upsertMessage(view: SessionView, message: Message): Pick<SessionView, "messages" | "toolResults"> {
	const messages = view.messages;
	let index = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		const candidate = messages[i];
		if (candidate && sameMessage(candidate, message)) {
			index = i;
			break;
		}
	}
	const next = index >= 0 ? messages.map((m, i) => (i === index ? message : m)) : [...messages, message];
	const toolResults =
		message.role === "toolResult" ? { ...view.toolResults, [message.toolCallId]: message } : view.toolResults;
	return { messages: next, toolResults };
}

function finalizeStreaming(view: SessionView): Pick<SessionView, "messages" | "toolResults" | "streaming"> {
	if (!view.streaming) return { messages: view.messages, toolResults: view.toolResults, streaming: undefined };
	const finished: AssistantMessage =
		view.streaming.stopReason === "pending" ? { ...view.streaming, stopReason: "aborted" } : view.streaming;
	return { ...upsertMessage(view, finished), streaming: undefined };
}

// ---------------------------------------------------------------------------
// Content blocks of the streaming message
// ---------------------------------------------------------------------------

function placeholderAssistant(messageId: string): AssistantMessage {
	return {
		role: "assistant",
		id: messageId,
		content: [],
		provider: "",
		model: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
		stopReason: "pending",
		timestamp: Date.now(),
	};
}

function setBlock(content: readonly ContentBlock[], index: number, block: ContentBlock): ContentBlock[] {
	const next = content.slice();
	while (next.length < index) next.push({ type: "text", text: "" });
	next[index] = block;
	return next;
}

function appendDelta(
	current: ContentBlock | undefined,
	kind: "text" | "thinking" | "toolArgs",
	delta: string,
): ContentBlock {
	switch (kind) {
		case "text":
			return current?.type === "text" ? { ...current, text: current.text + delta } : { type: "text", text: delta };
		case "thinking":
			return current?.type === "thinking"
				? { ...current, thinking: current.thinking + delta }
				: { type: "thinking", thinking: delta };
		case "toolArgs": {
			if (current?.type === "toolCall") return { ...current, partialJson: (current.partialJson ?? "") + delta };
			return { type: "toolCall", id: "", name: "", arguments: undefined, partialJson: delta };
		}
	}
}

function withStreaming(view: SessionView, messageId: string, content: ContentBlock[]): SessionView {
	const streaming = view.streaming ?? placeholderAssistant(messageId);
	return { ...view, streaming: { ...streaming, content }, runActive: true };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/** Drop the local bash card once the host's transcript carries a new bashExecution for the same command. */
function bashRunAfterReplace(view: SessionView, messages: readonly Message[]): BashRun | undefined {
	const run = view.bashRun;
	if (!run) return undefined;
	const known = new Set<string>();
	for (const message of view.messages) if (message.role === "bashExecution") known.add(message.id);
	const arrived = messages.some(
		(message) =>
			message.role === "bashExecution" &&
			!known.has(message.id) &&
			(run.command === undefined || message.command === run.command),
	);
	return arrived ? undefined : run;
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
	if (!(key in record)) return record;
	const { [key]: _removed, ...rest } = record;
	return rest;
}

/** Pure reducer: returns a new view; untouched fields keep their identity. */
export function applySessionEvent(view: SessionView, event: SessionEvent): SessionView {
	switch (event.type) {
		case "run.start":
			return {
				...view,
				runActive: true,
				state: { ...view.state, isStreaming: true },
				retry: undefined,
				processExit: undefined,
			};
		case "run.end": {
			return {
				...view,
				...finalizeStreaming(view),
				runActive: event.willRetry,
				activeTools: [],
				state: { ...view.state, isStreaming: event.willRetry },
			};
		}
		case "run.settled":
			return {
				...view,
				...finalizeStreaming(view),
				runActive: false,
				activeTools: [],
				retry: undefined,
				state: { ...view.state, isStreaming: false },
			};
		case "turn.start":
		case "turn.end":
			return view;
		case "message.start": {
			const message = event.message;
			if (message.role === "assistant") return { ...view, streaming: message, runActive: true };
			return {
				...view,
				...upsertMessage(view, message),
				bashRun: message.role === "bashExecution" ? undefined : view.bashRun,
			};
		}
		case "block.start": {
			const content = view.streaming?.content ?? [];
			return withStreaming(view, event.messageId, setBlock(content, event.contentIndex, event.block));
		}
		case "block.delta": {
			const content = view.streaming?.content ?? [];
			const next = appendDelta(content[event.contentIndex], event.kind, event.delta);
			return withStreaming(view, event.messageId, setBlock(content, event.contentIndex, next));
		}
		case "block.end": {
			const content = view.streaming?.content ?? [];
			return withStreaming(view, event.messageId, setBlock(content, event.contentIndex, event.block));
		}
		case "message.end": {
			const message = event.message;
			if (message.role === "assistant") {
				return { ...view, ...upsertMessage(view, message), streaming: undefined };
			}
			return {
				...view,
				...upsertMessage(view, message),
				bashRun: message.role === "bashExecution" ? undefined : view.bashRun,
			};
		}
		case "tool.start": {
			const others = view.activeTools.filter((run) => run.toolCallId !== event.run.toolCallId);
			return { ...view, activeTools: [...others, event.run] };
		}
		case "tool.update":
			return {
				...view,
				activeTools: view.activeTools.map((run) =>
					run.toolCallId === event.toolCallId ? { ...run, partial: event.partial } : run,
				),
			};
		case "tool.end":
			return {
				...view,
				...upsertMessage(view, event.result),
				activeTools: view.activeTools.filter((run) => run.toolCallId !== event.toolCallId),
			};
		case "queue.update":
			return { ...view, queue: { steering: event.steering, followUp: event.followUp } };
		case "compaction.start":
			return { ...view, compaction: { reason: event.reason }, state: { ...view.state, isCompacting: true } };
		case "compaction.end":
			return {
				...view,
				compaction: undefined,
				state: { ...view.state, isCompacting: false },
				lastError: event.errorMessage ?? view.lastError,
			};
		case "retry.start":
			return {
				...view,
				retry: {
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					delayMs: event.delayMs,
					errorMessage: event.errorMessage,
				},
			};
		case "retry.end":
			return { ...view, retry: undefined, lastError: event.success ? view.lastError : event.finalError };
		case "bash.output": {
			// Deltas batched behind the command's answer add nothing: the result carries the full output.
			if (view.bashRun?.result) return view;
			const current =
				view.bashRun && view.bashRun.commandId === event.commandId
					? view.bashRun
					: { commandId: event.commandId, command: view.bashRun?.command, output: "", startedAt: Date.now() };
			return { ...view, bashRun: { ...current, output: current.output + event.delta } };
		}
		case "state.update":
			return { ...view, state: { ...view.state, ...event.state } };
		case "stats.update":
			return { ...view, stats: event.stats };
		case "ui.request": {
			const others = view.pendingUi.filter((request) => request.id !== event.request.id);
			return { ...view, pendingUi: [...others, event.request] };
		}
		case "ui.resolved":
			return { ...view, pendingUi: view.pendingUi.filter((request) => request.id !== event.requestId) };
		case "status.set":
			return {
				...view,
				statuses:
					event.text === undefined
						? withoutKey(view.statuses, event.key)
						: { ...view.statuses, [event.key]: event.text },
			};
		case "widget.set":
			return {
				...view,
				widgets:
					event.widget === undefined
						? withoutKey(view.widgets, event.key)
						: { ...view.widgets, [event.key]: event.widget },
			};
		case "notify":
			return view; // surfaced as a toast by the wiring layer
		case "title.set":
			return { ...view, title: event.title };
		case "editor.set":
			return { ...view, editorRequest: { text: event.text, nonce: (view.editorRequest?.nonce ?? 0) + 1 } };
		case "process.exit":
			return {
				...view,
				...finalizeStreaming(view),
				runActive: false,
				activeTools: [],
				retry: undefined,
				bashRun: undefined,
				processExit: { code: event.code, signal: event.signal },
				state: { ...view.state, processAlive: false, isStreaming: false, isCompacting: false },
			};
		case "process.error":
			return { ...view, lastError: event.message };
		case "transcript.replace": {
			const streaming =
				view.streaming && event.messages.some((m) => m.id === view.streaming?.id) ? undefined : view.streaming;
			return {
				...view,
				messages: event.messages,
				toolResults: indexToolResults(event.messages),
				leafId: event.leafId,
				streaming,
				bashRun: bashRunAfterReplace(view, event.messages),
			};
		}
	}
}

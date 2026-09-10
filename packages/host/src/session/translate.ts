/**
 * Translate pi wire shapes into Tau protocol shapes. Pure functions; no I/O.
 */
import type {
	AssistantMessage,
	ContentBlock,
	ForkMessageInfo,
	Message,
	ModelInfo,
	SessionState,
	SessionStats,
	StopReason,
	TextBlock,
	ThinkingLevel,
	ToolResultMessage,
	TreeNode,
	Usage,
} from "@pi-tau/shared";
import type {
	PiEntry,
	PiEntryBase,
	PiImageContent,
	PiMessage,
	PiModel,
	PiSessionState,
	PiSessionStats,
	PiTextContent,
	PiToolResultMessage,
	PiTreeNode,
	PiUsage,
} from "../pi/rpc-types.js";

const STOP_REASONS: ReadonlySet<string> = new Set([
	"stop",
	"length",
	"toolUse",
	"error",
	"aborted",
	"pending",
	"deferred",
]);
const THINKING_LEVELS: ReadonlySet<string> = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export function toStopReason(value: string | undefined): StopReason {
	return value !== undefined && STOP_REASONS.has(value) ? (value as StopReason) : "stop";
}

export function toThinkingLevel(value: string | undefined): ThinkingLevel {
	return value !== undefined && THINKING_LEVELS.has(value) ? (value as ThinkingLevel) : "off";
}

export function toUsage(usage: PiUsage | undefined): Usage {
	if (!usage) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };
	const out: Usage = {
		input: usage.input,
		output: usage.output,
		cacheRead: usage.cacheRead,
		cacheWrite: usage.cacheWrite,
		totalTokens: usage.totalTokens,
		cost: usage.cost?.total ?? 0,
	};
	if (usage.reasoning !== undefined) out.reasoning = usage.reasoning;
	return out;
}

export function toModelInfo(model: PiModel): ModelInfo {
	return {
		provider: model.provider,
		id: model.id,
		name: model.name,
		reasoning: model.reasoning,
		input: [...model.input],
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
	};
}

function userContentToBlocks(content: string | (PiTextContent | PiImageContent)[]): (TextBlock | ContentBlock)[] {
	if (typeof content === "string") return [{ type: "text", text: content }];
	return content.map((c) =>
		c.type === "text" ? { type: "text", text: c.text } : { type: "image", mimeType: c.mimeType, data: c.data },
	);
}

function toolResultContent(content: (PiTextContent | PiImageContent)[] | undefined): ToolResultMessage["content"] {
	if (!Array.isArray(content)) return [];
	return content.map((c) =>
		c.type === "text" ? { type: "text", text: c.text } : { type: "image", mimeType: c.mimeType, data: c.data },
	);
}

export function toToolResultMessage(id: string, msg: PiToolResultMessage): ToolResultMessage {
	const out: ToolResultMessage = {
		role: "toolResult",
		id,
		toolCallId: msg.toolCallId,
		toolName: msg.toolName,
		content: toolResultContent(msg.content),
		isError: msg.isError === true,
		timestamp: msg.timestamp ?? Date.now(),
	};
	if (msg.details !== undefined) out.details = msg.details;
	return out;
}

export function toAssistantMessage(id: string, msg: Extract<PiMessage, { role: "assistant" }>): AssistantMessage {
	const content: ContentBlock[] = [];
	for (const c of msg.content ?? []) {
		if (c.type === "text") content.push({ type: "text", text: c.text });
		else if (c.type === "thinking") content.push({ type: "thinking", thinking: c.thinking });
		else if (c.type === "toolCall") content.push({ type: "toolCall", id: c.id, name: c.name, arguments: c.arguments });
	}
	const out: AssistantMessage = {
		role: "assistant",
		id,
		content,
		provider: msg.provider,
		model: msg.model,
		usage: toUsage(msg.usage),
		stopReason: toStopReason(msg.stopReason),
		timestamp: msg.timestamp ?? Date.now(),
	};
	if (msg.errorMessage !== undefined) out.errorMessage = msg.errorMessage;
	return out;
}

/** Convert any pi message into a Tau message. Returns undefined for messages that are not shown. */
export function toMessage(id: string, msg: PiMessage): Message | undefined {
	switch (msg.role) {
		case "user":
			return { role: "user", id, content: userContentToBlocks(msg.content), timestamp: msg.timestamp ?? Date.now() };
		case "assistant":
			return toAssistantMessage(id, msg);
		case "toolResult":
			return toToolResultMessage(id, msg);
		case "bashExecution": {
			const out: Message = {
				role: "bashExecution",
				id,
				command: msg.command,
				output: msg.output,
				exitCode: msg.exitCode,
				cancelled: msg.cancelled,
				truncated: msg.truncated,
				timestamp: msg.timestamp ?? Date.now(),
			};
			if (msg.excludeFromContext !== undefined) out.excludeFromContext = msg.excludeFromContext;
			return out;
		}
		case "custom": {
			if (!msg.display) return undefined;
			const out: Message = {
				role: "custom",
				id,
				customType: msg.customType,
				content: typeof msg.content === "string" ? msg.content : toolResultContent(msg.content),
				display: true,
				timestamp: msg.timestamp ?? Date.now(),
			};
			if (msg.details !== undefined) out.details = msg.details;
			return out;
		}
		case "branchSummary":
			return {
				role: "branchSummary",
				id,
				summary: msg.summary,
				fromId: msg.fromId ?? null,
				timestamp: msg.timestamp ?? Date.now(),
			};
		case "compactionSummary":
			return {
				role: "compactionSummary",
				id,
				summary: msg.summary,
				tokensBefore: msg.tokensBefore,
				timestamp: msg.timestamp ?? Date.now(),
			};
		default:
			return undefined;
	}
}

/** Build the transcript of the active branch from all entries and the leaf id. */
export function entriesToTranscript(entries: PiEntry[], leafId: string | null | undefined): Message[] {
	const byId = new Map<string, PiEntry>();
	for (const e of entries) byId.set(e.id, e);
	const path: PiEntry[] = [];
	let cursor = leafId ? byId.get(leafId) : undefined;
	const seen = new Set<string>();
	while (cursor && !seen.has(cursor.id)) {
		seen.add(cursor.id);
		path.push(cursor);
		cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
	}
	path.reverse();
	const messages: Message[] = [];
	for (const entry of path) {
		const ts = Date.parse(entry.timestamp) || Date.now();
		switch (entry.type) {
			case "message": {
				const m = toMessage(entry.id, entry.message);
				if (m) messages.push(m);
				break;
			}
			case "compaction":
				messages.push({
					role: "compactionSummary",
					id: entry.id,
					summary: entry.summary,
					tokensBefore: entry.tokensBefore,
					timestamp: ts,
				});
				break;
			case "branch_summary":
				messages.push({
					role: "branchSummary",
					id: entry.id,
					summary: entry.summary,
					fromId: entry.fromId,
					timestamp: ts,
				});
				break;
			case "custom_message":
				if (entry.display) {
					const out: Message = {
						role: "custom",
						id: entry.id,
						customType: entry.customType,
						content: typeof entry.content === "string" ? entry.content : toolResultContent(entry.content),
						display: true,
						timestamp: ts,
					};
					if (entry.details !== undefined) out.details = entry.details;
					messages.push(out);
				}
				break;
			default:
				break;
		}
	}
	return messages;
}

export function toSessionState(pi: PiSessionState, cwd: string, processAlive: boolean, autoRetry = true): SessionState {
	const state: SessionState = {
		sessionId: pi.sessionId,
		cwd,
		thinkingLevel: toThinkingLevel(pi.thinkingLevel),
		isStreaming: pi.isStreaming,
		isCompacting: pi.isCompacting,
		steeringMode: pi.steeringMode,
		followUpMode: pi.followUpMode,
		autoCompactionEnabled: pi.autoCompactionEnabled,
		autoRetryEnabled: autoRetry,
		messageCount: pi.messageCount,
		pendingMessageCount: pi.pendingMessageCount,
		processAlive,
	};
	if (pi.sessionFile !== undefined) state.sessionFile = pi.sessionFile;
	if (pi.sessionName !== undefined) state.sessionName = pi.sessionName;
	if (pi.model) state.model = toModelInfo(pi.model);
	return state;
}

export function toSessionStats(pi: PiSessionStats): SessionStats {
	const stats: SessionStats = {
		userMessages: pi.userMessages,
		assistantMessages: pi.assistantMessages,
		toolCalls: pi.toolCalls,
		toolResults: pi.toolResults,
		totalMessages: pi.totalMessages,
		tokens: { ...pi.tokens },
		cost: pi.cost,
	};
	if (pi.contextUsage) stats.contextUsage = { ...pi.contextUsage };
	return stats;
}

function entryPreview(entry: PiEntry): { preview: string; role?: Message["role"] } {
	if (entry.type === "message") {
		const m = entry.message;
		let text = "";
		if (m.role === "user")
			text =
				typeof m.content === "string"
					? m.content
					: m.content.map((c) => (c.type === "text" ? c.text : "[image]")).join(" ");
		else if (m.role === "assistant")
			text = m.content.map((c) => (c.type === "text" ? c.text : c.type === "toolCall" ? `[${c.name}]` : "")).join(" ");
		else if (m.role === "toolResult")
			text = `${m.toolName}: ${m.content.map((c) => (c.type === "text" ? c.text : "[image]")).join(" ")}`;
		else if (m.role === "bashExecution") text = `! ${m.command}`;
		else if (m.role === "custom") text = `[${m.customType}]`;
		else if (m.role === "branchSummary" || m.role === "compactionSummary") text = m.summary;
		return { preview: text.replace(/\s+/g, " ").trim().slice(0, 160), role: m.role };
	}
	if (entry.type === "compaction" || entry.type === "branch_summary") return { preview: entry.summary.slice(0, 160) };
	if (entry.type === "model_change") return { preview: `model: ${entry.provider}/${entry.modelId}` };
	if (entry.type === "thinking_level_change") return { preview: `thinking: ${entry.thinkingLevel}` };
	if (entry.type === "session_info") return { preview: `name: ${entry.name ?? ""}` };
	if (entry.type === "label") return { preview: `label: ${entry.label ?? ""}` };
	if (entry.type === "custom_message" || entry.type === "custom") return { preview: `[${entry.customType}]` };
	return { preview: (entry as PiEntryBase).type };
}

/**
 * Convert pi's tree into Tau nodes. Tau bookkeeping entries (custom entries whose
 * customType starts with "tau.") are removed and their children re-attached to the
 * parent. The active path is derived from the tree itself via parentId links.
 */
export function toTree(nodes: PiTreeNode[], leafId: string | null | undefined): TreeNode[] {
	const parentOf = new Map<string, string | null>();
	const index = (list: PiTreeNode[]): void => {
		for (const node of list) {
			parentOf.set(node.entry.id, node.entry.parentId);
			index(node.children);
		}
	};
	index(nodes);
	const isBookkeeping = (node: PiTreeNode): boolean =>
		node.entry.type === "custom" &&
		typeof node.entry.customType === "string" &&
		node.entry.customType.startsWith("tau.");
	// Resolve the visible parent of an entry, skipping bookkeeping entries.
	const byId = new Map<string, PiTreeNode>();
	const collect = (list: PiTreeNode[]): void => {
		for (const node of list) {
			byId.set(node.entry.id, node);
			collect(node.children);
		}
	};
	collect(nodes);
	const visibleParent = (id: string | null): string | null => {
		let cursor = id;
		while (cursor) {
			const node = byId.get(cursor);
			if (!node) return cursor;
			if (!isBookkeeping(node)) return cursor;
			cursor = node.entry.parentId;
		}
		return null;
	};
	const activeIds = new Set<string>();
	let cursor: string | null | undefined = leafId ?? null;
	while (cursor) {
		activeIds.add(cursor);
		cursor = parentOf.get(cursor) ?? null;
	}
	const convert = (node: PiTreeNode, parentId: string | null): TreeNode[] => {
		if (isBookkeeping(node)) return node.children.flatMap((child) => convert(child, parentId));
		const { preview, role } = entryPreview(node.entry);
		const out: TreeNode = {
			id: node.entry.id,
			parentId: visibleParent(parentId),
			type: node.entry.type,
			preview,
			timestamp: node.entry.timestamp,
			children: node.children.flatMap((child) => convert(child, node.entry.id)),
			onActivePath: activeIds.has(node.entry.id),
		};
		if (role !== undefined) out.role = role;
		if (node.label !== undefined) out.label = node.label;
		return [out];
	};
	return nodes.flatMap((node) => convert(node, node.entry.parentId));
}

export function toForkMessages(
	raw: { entryId: string; text: string }[],
	entries: PiEntry[] | undefined,
): ForkMessageInfo[] {
	const byId = new Map((entries ?? []).map((e) => [e.id, e] as const));
	return raw.map((m) => ({ entryId: m.entryId, text: m.text, timestamp: byId.get(m.entryId)?.timestamp ?? "" }));
}

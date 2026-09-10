/**
 * Minimal, host-internal view of pi's stdio RPC protocol (pi-coding-agent 0.85.x).
 * Kept narrow on purpose: only the fields the host reads. Everything else is `unknown`.
 * Reference: packages/coding-agent/docs/rpc.md and docs/research/rpc-sample-0.85.1.jsonl.
 */

export interface PiUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning?: number;
	totalTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export interface PiTextContent {
	type: "text";
	text: string;
}
export interface PiThinkingContent {
	type: "thinking";
	thinking: string;
	redacted?: boolean;
}
export interface PiImageContent {
	type: "image";
	data: string;
	mimeType: string;
}
export interface PiToolCall {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}
export type PiAssistantContent = PiTextContent | PiThinkingContent | PiToolCall;

export interface PiUserMessage {
	role: "user";
	content: string | (PiTextContent | PiImageContent)[];
	timestamp: number;
}
export interface PiAssistantMessage {
	role: "assistant";
	content: PiAssistantContent[];
	provider: string;
	model: string;
	usage: PiUsage;
	stopReason: string;
	errorMessage?: string;
	timestamp: number;
}
export interface PiToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (PiTextContent | PiImageContent)[];
	details?: unknown;
	isError: boolean;
	timestamp: number;
}
export interface PiBashExecutionMessage {
	role: "bashExecution";
	command: string;
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
	excludeFromContext?: boolean;
	timestamp: number;
}
export interface PiCustomMessage {
	role: "custom";
	customType: string;
	content: string | (PiTextContent | PiImageContent)[];
	display: boolean;
	details?: unknown;
	timestamp: number;
}
export interface PiBranchSummaryMessage {
	role: "branchSummary";
	summary: string;
	fromId: string | null;
	timestamp: number;
}
export interface PiCompactionSummaryMessage {
	role: "compactionSummary";
	summary: string;
	tokensBefore: number;
	timestamp: number;
}
export type PiMessage =
	| PiUserMessage
	| PiAssistantMessage
	| PiToolResultMessage
	| PiBashExecutionMessage
	| PiCustomMessage
	| PiBranchSummaryMessage
	| PiCompactionSummaryMessage;

export interface PiModel {
	id: string;
	name: string;
	provider: string;
	reasoning: boolean;
	input: string[];
	contextWindow: number;
	maxTokens: number;
}

export interface PiSessionState {
	model?: PiModel;
	thinkingLevel: string;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	autoCompactionEnabled: boolean;
	messageCount: number;
	pendingMessageCount: number;
}

export interface PiSessionStats {
	sessionFile: string | undefined;
	sessionId: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	cost: number;
	contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

export interface PiEntryBase {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
}
export type PiEntry = PiEntryBase &
	(
		| { type: "message"; message: PiMessage }
		| { type: "compaction"; summary: string; firstKeptEntryId: string; tokensBefore: number }
		| { type: "branch_summary"; fromId: string; summary: string }
		| { type: "custom"; customType: string; data?: unknown }
		| {
				type: "custom_message";
				customType: string;
				content: string | (PiTextContent | PiImageContent)[];
				details?: unknown;
				display: boolean;
		  }
		| { type: "label"; targetId: string; label: string | undefined }
		| { type: "session_info"; name?: string }
		| { type: "model_change"; provider: string; modelId: string }
		| { type: "thinking_level_change"; thinkingLevel: string }
	);

export interface PiTreeNode {
	entry: PiEntry;
	children: PiTreeNode[];
	label?: string;
	labelTimestamp?: string;
}

export type PiAssistantMessageEvent =
	| { type: "text_start"; contentIndex: number }
	| { type: "text_delta"; contentIndex: number; delta: string }
	| { type: "text_end"; contentIndex: number; content: string }
	| { type: "thinking_start"; contentIndex: number }
	| { type: "thinking_delta"; contentIndex: number; delta: string }
	| { type: "thinking_end"; contentIndex: number; content: string }
	| { type: "toolcall_start"; contentIndex: number; id: string; toolName: string }
	| { type: "toolcall_delta"; contentIndex: number; delta: string }
	| { type: "toolcall_end"; contentIndex: number; toolCall: PiToolCall };

export type PiEvent =
	| { type: "agent_start" }
	| { type: "agent_end"; messages: PiMessage[]; willRetry: boolean }
	| { type: "agent_settled" }
	| { type: "turn_start" }
	| { type: "turn_end"; message: PiMessage; toolResults: PiToolResultMessage[] }
	| { type: "message_start"; message: PiMessage }
	| { type: "message_update"; usage: PiUsage; assistantMessageEvent: PiAssistantMessageEvent }
	| { type: "message_end"; message: PiMessage }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
	| { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
	| { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean }
	| { type: "queue_update"; steering: string[]; followUp: string[] }
	| { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
	| {
			type: "compaction_end";
			reason: "manual" | "threshold" | "overflow";
			result?: { summary: string } | null;
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string;
	  }
	| { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
	| { type: "bash_execution_update"; id?: string; delta: string }
	| { type: "session_info_changed"; name: string | undefined }
	| { type: "thinking_level_changed"; level: string }
	| { type: "entry_appended"; entry: PiEntry }
	| { type: string; [key: string]: unknown };

export type PiExtensionUiRequest =
	| { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "input"; title: string; placeholder?: string; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "editor"; title: string; prefill?: string }
	| {
			type: "extension_ui_request";
			id: string;
			method: "notify";
			message: string;
			notifyType?: "info" | "warning" | "error";
	  }
	| { type: "extension_ui_request"; id: string; method: "setStatus"; statusKey: string; statusText?: string }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setWidget";
			widgetKey: string;
			widgetLines?: string[];
			widgetPlacement?: "aboveEditor" | "belowEditor";
	  }
	| { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
	| { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string };

export type PiExtensionUiResponse =
	| { type: "extension_ui_response"; id: string; value: string }
	| { type: "extension_ui_response"; id: string; confirmed: boolean }
	| { type: "extension_ui_response"; id: string; cancelled: true };

export interface PiResponse {
	type: "response";
	id?: string;
	command: string;
	success: boolean;
	data?: unknown;
	error?: string;
}

export interface PiExtensionError {
	type: "extension_error";
	extensionPath?: string;
	event?: string;
	error: string;
}

export type PiStdoutRecord = PiResponse | PiExtensionUiRequest | PiExtensionError | PiEvent;

/** Commands the host sends; `id` is added by the process wrapper. */
export type PiCommand =
	| { type: "prompt"; message: string; images?: PiImageContent[]; streamingBehavior?: "steer" | "followUp" }
	| { type: "steer"; message: string; images?: PiImageContent[] }
	| { type: "follow_up"; message: string; images?: PiImageContent[] }
	| { type: "abort" }
	| { type: "clear_queue" }
	| { type: "new_session"; parentSession?: string }
	| { type: "get_state" }
	| { type: "set_model"; provider: string; modelId: string }
	| { type: "cycle_model" }
	| { type: "get_available_models" }
	| { type: "set_thinking_level"; level: string }
	| { type: "cycle_thinking_level" }
	| { type: "get_available_thinking_levels" }
	| { type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
	| { type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }
	| { type: "compact"; customInstructions?: string }
	| { type: "set_auto_compaction"; enabled: boolean }
	| { type: "set_auto_retry"; enabled: boolean }
	| { type: "abort_retry" }
	| { type: "bash"; command: string; excludeFromContext?: boolean }
	| { type: "abort_bash" }
	| { type: "get_session_stats" }
	| { type: "export_html"; outputPath?: string }
	| { type: "switch_session"; sessionPath: string }
	| { type: "fork"; entryId: string }
	| { type: "clone" }
	| { type: "get_fork_messages" }
	| { type: "get_entries"; since?: string }
	| { type: "get_tree" }
	| { type: "get_last_assistant_text" }
	| { type: "set_session_name"; name: string }
	| { type: "get_messages" }
	| { type: "get_commands" };

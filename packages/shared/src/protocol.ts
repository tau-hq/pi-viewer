/**
 * Tau wire protocol between the browser client and the host.
 *
 * This file is deliberately independent of pi's packages. The host translates
 * pi's RPC events into these shapes (anti-corruption layer), so a pi upgrade
 * only ever touches the host. Everything here must be plain JSON.
 */

export const TAU_PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Content and messages
// ---------------------------------------------------------------------------

export interface TextBlock {
	type: "text";
	text: string;
}

export interface ThinkingBlock {
	type: "thinking";
	thinking: string;
}

export interface ImageBlock {
	type: "image";
	/** MIME type such as image/png. */
	mimeType: string;
	/** Base64 payload without data: prefix. */
	data: string;
}

export interface ToolCallBlock {
	type: "toolCall";
	id: string;
	name: string;
	/** Parsed arguments; while streaming this may be a partial JSON string. */
	arguments: unknown;
	/** Raw argument text accumulated while streaming. */
	partialJson?: string;
}

export type ContentBlock = TextBlock | ThinkingBlock | ImageBlock | ToolCallBlock;

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning?: number;
	totalTokens: number;
	/** Total cost in USD as reported by pi. */
	cost: number;
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted" | "pending" | "deferred";

export interface UserMessage {
	role: "user";
	id: string;
	content: ContentBlock[];
	timestamp: number;
}

export interface AssistantMessage {
	role: "assistant";
	id: string;
	content: ContentBlock[];
	provider: string;
	model: string;
	usage: Usage;
	stopReason: StopReason;
	errorMessage?: string;
	timestamp: number;
}

export interface ToolResultMessage {
	role: "toolResult";
	id: string;
	toolCallId: string;
	toolName: string;
	content: (TextBlock | ImageBlock)[];
	/** Tool specific structured details (diffs, file info, ...). */
	details?: unknown;
	isError: boolean;
	timestamp: number;
}

export interface BashExecutionMessage {
	role: "bashExecution";
	id: string;
	command: string;
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
	excludeFromContext?: boolean;
	timestamp: number;
}

export interface CustomMessage {
	role: "custom";
	id: string;
	customType: string;
	content: string | (TextBlock | ImageBlock)[];
	display: boolean;
	details?: unknown;
	timestamp: number;
}

export interface BranchSummaryMessage {
	role: "branchSummary";
	id: string;
	summary: string;
	fromId: string | null;
	timestamp: number;
}

export interface CompactionSummaryMessage {
	role: "compactionSummary";
	id: string;
	summary: string;
	tokensBefore: number;
	timestamp: number;
}

export type Message =
	| UserMessage
	| AssistantMessage
	| ToolResultMessage
	| BashExecutionMessage
	| CustomMessage
	| BranchSummaryMessage
	| CompactionSummaryMessage;

export type MessageRole = Message["role"];

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelInfo {
	provider: string;
	id: string;
	name: string;
	reasoning: boolean;
	/** "text" and optionally "image". */
	input: string[];
	contextWindow: number;
	maxTokens: number;
}

export type QueueMode = "all" | "one-at-a-time";

/**
 * How much the agent may do on its own, in the order the UI shows them:
 * auto = never ask, acceptEdits = ask only before dangerous shell commands,
 * manual = ask before every file or shell change (default), strict = ask before every tool.
 */
export type ApprovalMode = "auto" | "acceptEdits" | "manual" | "strict";

export interface SessionState {
	sessionId: string;
	sessionFile?: string;
	sessionName?: string;
	cwd: string;
	model?: ModelInfo;
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: QueueMode;
	followUpMode: QueueMode;
	autoCompactionEnabled: boolean;
	/** pi's `retry.enabled` setting, read when the session starts (pi never reports it live). */
	autoRetryEnabled: boolean;
	/** Undefined when Tau's pi extension is not loaded, so the client can hide the control. */
	approvalMode?: ApprovalMode;
	/** An extension dialog (a tool approval, say) is waiting for an answer. */
	needsInput: boolean;
	/** A `!` shell command is running. pi reports no run for those, so the host tracks it. */
	bashRunning: boolean;
	/** The last run ended in an error or was aborted, and nothing has run since. */
	lastRunFailed: boolean;
	messageCount: number;
	pendingMessageCount: number;
	/** True while the pi process for this session is alive. */
	processAlive: boolean;
}

export interface ToolRun {
	toolCallId: string;
	toolName: string;
	args: unknown;
	startedAt: number;
	/** Cumulative partial result while running. */
	partial?: unknown;
}

export interface UiSelectRequest {
	id: string;
	method: "select";
	title: string;
	options: string[];
	timeoutMs?: number;
}
export interface UiConfirmRequest {
	id: string;
	method: "confirm";
	title: string;
	message: string;
	timeoutMs?: number;
}
export interface UiInputRequest {
	id: string;
	method: "input";
	title: string;
	placeholder?: string;
	timeoutMs?: number;
}
export interface UiEditorRequest {
	id: string;
	method: "editor";
	title: string;
	prefill?: string;
}
export type UiRequest = UiSelectRequest | UiConfirmRequest | UiInputRequest | UiEditorRequest;

export type UiResponse =
	| { id: string; value: string }
	| { id: string; confirmed: boolean }
	| { id: string; cancelled: true };

export interface Widget {
	lines: string[];
	placement: "aboveEditor" | "belowEditor";
}

export interface ContextUsage {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

export interface SessionStats {
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	cost: number;
	contextUsage?: ContextUsage;
}

export interface SessionSnapshot {
	state: SessionState;
	/** Transcript of the active branch, oldest first. */
	messages: Message[];
	/** Entry id of the current leaf, when known. */
	leafId?: string;
	/** Assistant message currently being streamed, if any. */
	streaming?: AssistantMessage;
	queue: { steering: string[]; followUp: string[] };
	activeTools: ToolRun[];
	statuses: Record<string, string>;
	widgets: Record<string, Widget>;
	pendingUi: UiRequest[];
	stats?: SessionStats;
	retry?: { attempt: number; maxAttempts: number; delayMs: number; errorMessage: string };
}

// ---------------------------------------------------------------------------
// Session events (host -> client), each carries a per-session seq
// ---------------------------------------------------------------------------

export type SessionEvent =
	| { type: "run.start" }
	| { type: "run.end"; willRetry: boolean }
	| { type: "run.settled" }
	| { type: "turn.start" }
	| { type: "turn.end" }
	| { type: "message.start"; message: Message }
	| { type: "block.start"; messageId: string; contentIndex: number; block: ContentBlock }
	| {
			type: "block.delta";
			messageId: string;
			contentIndex: number;
			kind: "text" | "thinking" | "toolArgs";
			delta: string;
	  }
	| { type: "block.end"; messageId: string; contentIndex: number; block: ContentBlock }
	| { type: "message.end"; message: Message }
	| { type: "tool.start"; run: ToolRun }
	| { type: "tool.update"; toolCallId: string; partial: unknown }
	| { type: "tool.end"; toolCallId: string; result: ToolResultMessage }
	| { type: "queue.update"; steering: string[]; followUp: string[] }
	| { type: "compaction.start"; reason: "manual" | "threshold" | "overflow" }
	| {
			type: "compaction.end";
			reason: "manual" | "threshold" | "overflow";
			aborted: boolean;
			errorMessage?: string;
			summary?: string;
	  }
	| { type: "retry.start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
	| { type: "retry.end"; success: boolean; attempt: number; finalError?: string }
	| { type: "bash.output"; commandId: string; delta: string }
	| { type: "state.update"; state: Partial<SessionState> }
	| { type: "stats.update"; stats: SessionStats }
	| { type: "ui.request"; request: UiRequest }
	| { type: "ui.resolved"; requestId: string }
	| { type: "status.set"; key: string; text?: string }
	| { type: "widget.set"; key: string; widget?: Widget }
	| { type: "notify"; message: string; level: "info" | "warning" | "error" }
	| { type: "title.set"; title: string }
	| { type: "editor.set"; text: string }
	| { type: "process.exit"; code: number | null; signal?: string }
	| { type: "process.error"; message: string }
	/** Transcript was rebuilt from pi (after a run, fork, navigate). Replace local copy. */
	| { type: "transcript.replace"; messages: Message[]; leafId?: string };

// ---------------------------------------------------------------------------
// Sessions and host information
// ---------------------------------------------------------------------------

export interface SessionSummary {
	id: string;
	/** False when the recorded working directory no longer exists; sessions there cannot be resumed. */
	cwdExists?: boolean;
	/** Group the user filed this session under; unset means it is grouped by project. */
	groupId?: string;
	path: string;
	cwd: string;
	name?: string;
	parentSessionPath?: string;
	created: number;
	modified: number;
	messageCount: number;
	firstMessage: string;
	/** True when a pi process is currently attached in the host. */
	running: boolean;
	/** True for a session pi does not write to disk (created with the ephemeral option). */
	ephemeral?: boolean;
	/** A dialog in this session is waiting for an answer (only known while a process is attached). */
	needsInput?: boolean;
	/** The last run in this session ended in an error (only known while a process is attached). */
	failed?: boolean;
	/** Host handle of the live session for this file, when one is attached. Subscribe with this. */
	handle?: string;
	isStreaming: boolean;
}

/**
 * A user-made group in the sidebar. Sessions not assigned to one keep falling back to
 * their project directory, which is what the sidebar shows when no group exists at all.
 */
/**
 * What the sidebar needs to draw its blocks: the groups the user made, and the names the user
 * gave project folders. A project group exists because sessions share a directory, so it has
 * no id to rename - its name is stored against the directory instead.
 */
export interface GroupsState {
	groups: SessionGroup[];
	/** Resolved working directory to the name the user gave it; absent means the folder name. */
	projectNames: Record<string, string>;
}

export interface SessionGroup {
	id: string;
	name: string;
	/** Ascending; the sidebar lists groups in this order, above the project groups. */
	order: number;
}

export interface ProjectInfo {
	cwd: string;
	name: string;
	sessionCount: number;
	lastModified: number;
	/** False when the directory is gone; opening a session or a terminal there fails. */
	exists: boolean;
}

export interface CommandInfo {
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill" | "builtin";
	scope?: string;
}

export interface HostInfo {
	name: string;
	version: string;
	piVersion: string;
	platform: string;
	homeCwd: string;
	defaultCwd: string;
}

export interface ToolInfo {
	name: string;
	description?: string;
	active: boolean;
}

export interface SearchMatch {
	/** pi's durable entry id: usable for tree navigation and for scrolling the transcript. */
	entryId: string;
	/** Which occurrence inside that entry this is, counted from zero in reading order. */
	index: number;
	role: MessageRole | "other";
	/** The matching line, trimmed, with the hit somewhere inside it. */
	preview: string;
	/** Character offset of the hit inside `preview`, so the client can mark it. */
	offset: number;
	length: number;
	/** False for a hit in an abandoned branch or in history that a compaction replaced. */
	onActivePath: boolean;
	timestamp: string;
}

export interface ForkMessageInfo {
	entryId: string;
	text: string;
	timestamp: string;
}

export interface TreeNode {
	id: string;
	parentId: string | null;
	type: string;
	role?: MessageRole;
	preview: string;
	timestamp: string;
	label?: string;
	children: TreeNode[];
	onActivePath: boolean;
}

// ---------------------------------------------------------------------------
// Commands (client -> host)
// ---------------------------------------------------------------------------

export interface ImageInput {
	mimeType: string;
	data: string;
}

// ---------------------------------------------------------------------------
// Provider authentication (host level, driven through pi's SDK)
// ---------------------------------------------------------------------------

export interface AuthMethodInfo {
	type: "api_key" | "oauth";
	label: string;
	/** OAuth methods backed by a provider subscription. */
	subscription?: boolean;
}

export interface AuthProviderInfo {
	id: string;
	name: string;
	methods: AuthMethodInfo[];
	/** Present when credentials currently resolve for this provider. */
	status?: { type: "api_key" | "oauth"; source?: string };
}

export type AuthPrompt =
	| { type: "text"; message: string; placeholder?: string }
	| { type: "secret"; message: string; placeholder?: string }
	| { type: "select"; message: string; options: { id: string; label: string; description?: string }[] }
	| { type: "manual_code"; message: string; placeholder?: string };

export type AuthFlowEvent =
	| { type: "info"; message: string; links?: { url: string; label?: string }[] }
	| { type: "auth_url"; url: string; instructions?: string }
	| {
			type: "device_code";
			userCode: string;
			verificationUri: string;
			intervalSeconds?: number;
			expiresInSeconds?: number;
	  }
	| { type: "progress"; message: string };

export interface PackageEntry {
	source: string;
	scope: "user" | "project";
	/** True when the package entry restricts which resources it contributes. */
	filtered: boolean;
	/** False when the package is configured but not downloaded yet. */
	installed: boolean;
	installedPath?: string;
}

export type ResourceKind = "extensions" | "skills" | "prompts" | "themes";

export interface ResourceEntry {
	kind: ResourceKind;
	path: string;
	name: string;
	enabled: boolean;
	/** Where it came from: a package source or "top-level" discovery. */
	source: string;
	scope: "user" | "project";
	origin: "package" | "top-level";
}

export interface ResourceOverview {
	extensions: ResourceEntry[];
	skills: ResourceEntry[];
	prompts: ResourceEntry[];
	themes: ResourceEntry[];
}

/** Options that pi only accepts at startup, so they belong to session creation. */
export interface SessionCreateOptions {
	systemPrompt?: string;
	appendSystemPrompt?: string;
	/** Strict allow-list of tool names; empty array means no tools at all. */
	tools?: string[];
	excludeTools?: string[];
	/** Extra extensions for this session only (paths, npm: or git: sources). */
	extensions?: string[];
	noContextFiles?: boolean;
	/** Do not write a session file. */
	ephemeral?: boolean;
	thinkingLevel?: ThinkingLevel;
}

export interface FileMatch {
	/** Path relative to the search directory; directories end with a slash. */
	path: string;
	isDirectory: boolean;
}

export interface TrustInfo {
	cwd: string;
	/** true trusted, false rejected, null undecided. */
	decision: boolean | null;
	/** True when the project actually carries resources that require a decision. */
	hasProjectResources: boolean;
}

export interface TerminalInfo {
	id: string;
	kind: "pi" | "shell";
	cwd: string;
	sessionPath?: string;
	alive: boolean;
	cols: number;
	rows: number;
	startedAt: number;
	/** Exit code once the process is gone; kept so a later attach can still show it. */
	exitCode?: number;
}

export type ConfigFile = "settings" | "models" | "keybindings";
export type ConfigScope = "global" | "project";

export interface ConfigDocument {
	file: ConfigFile;
	scope: ConfigScope;
	path: string;
	/** Empty string when the file does not exist yet. */
	content: string;
	exists: boolean;
}

export type HostCommand =
	| { type: "host.info" }
	| { type: "auth.providers" }
	/** Starts a login flow; the host answers with {flowId} and then streams auth.prompt / auth.event / auth.done. */
	| { type: "auth.login"; providerId: string; method: "api_key" | "oauth" }
	| { type: "auth.answer"; flowId: string; promptId: string; value: string }
	| { type: "auth.cancel"; flowId: string }
	| { type: "auth.logout"; providerId: string }
	/** Returns the raw JSONL of a session file for download. */
	| { type: "sessions.exportJsonl"; sessionPath: string }
	/** Project trust: pi only loads project-local extensions, skills and prompts from trusted directories. */
	| { type: "trust.get"; cwd: string }
	| { type: "trust.set"; cwd: string; trusted: boolean | null }
	// Terminals: a real PTY running pi's own terminal UI (kind "pi") or a shell, streamed as text.
	| { type: "terminal.open"; kind: "pi" | "shell"; cwd: string; sessionPath?: string; cols: number; rows: number }
	/**
	 * Attach this connection to a terminal. The host sends the scrollback as one
	 * `terminal.data` envelope BEFORE the result of this command, so clear the local
	 * buffer when you send it, not when the result arrives.
	 */
	| { type: "terminal.attach"; terminalId: string }
	| { type: "terminal.detach"; terminalId: string }
	| { type: "terminal.input"; terminalId: string; data: string }
	| { type: "terminal.resize"; terminalId: string; cols: number; rows: number }
	| { type: "terminal.close"; terminalId: string }
	/** Every terminal on the host, not scoped to a session or client: that is what makes reload and a second tab work. */
	| { type: "terminal.list" }
	/** Read one of pi's JSON configuration files as text (global scope lives in the agent dir, project scope in <cwd>/.pi). */
	| { type: "config.read"; file: ConfigFile; scope: ConfigScope; cwd?: string }
	/** Write a configuration file; the host validates that content is JSON. Restart sessions to apply. */
	| { type: "config.write"; file: ConfigFile; scope: ConfigScope; cwd?: string; content: string }
	| { type: "sessions.list"; cwd?: string }
	| { type: "projects.list" }
	| {
			type: "sessions.create";
			cwd: string;
			model?: { provider: string; id: string };
			name?: string;
			options?: SessionCreateOptions;
	  }
	/** Copy a JSONL session file into pi's session directory for `cwd`, then open it. */
	| { type: "sessions.import"; sourcePath: string; cwd?: string }
	| { type: "sessions.open"; sessionPath: string }
	| { type: "sessions.close"; sessionId: string }
	| { type: "sessions.delete"; sessionPath: string }
	/** The conversation straight from the session file; no pi process is started for it. */
	| { type: "sessions.preview"; sessionPath: string }
	| { type: "models.list" }
	/** Refresh the provider model catalogs from the network. */
	| { type: "models.refresh" }
	/** pi's own changelog, as Markdown. */
	| { type: "pi.changelog" }
	| { type: "packages.list"; cwd?: string }
	| { type: "packages.install"; source: string; scope: "user" | "project"; cwd?: string }
	| { type: "packages.remove"; source: string; scope: "user" | "project"; cwd?: string }
	| { type: "packages.update"; source?: string; cwd?: string }
	| { type: "resources.list"; cwd?: string }
	| {
			type: "resources.setEnabled";
			kind: ResourceKind;
			path: string;
			scope: "user" | "project";
			enabled: boolean;
			cwd?: string;
	  }
	/** Deep-merge a patch into settings.json; null values delete a key. */
	| { type: "settings.patch"; scope: ConfigScope; cwd?: string; patch: Record<string, unknown> }
	| { type: "groups.list" }
	| { type: "groups.create"; name: string }
	| { type: "groups.rename"; id: string; name: string }
	/** Deletes the group; its sessions fall back to their project. */
	| { type: "groups.delete"; id: string }
	/** Move one session into a group, or back to its project with `groupId: null`. */
	| { type: "groups.assign"; sessionPath: string; groupId: string | null }
	/** New order, given as the group ids from top to bottom. */
	| { type: "groups.reorder"; ids: string[] }
	/** Name a project group, or fall back to the folder name with `name: null`. */
	| { type: "groups.renameProject"; cwd: string; name: string | null }
	| { type: "fs.listDirs"; path?: string }
	/** Fuzzy project-file search for `@` mentions in the composer; respects .gitignore. */
	| { type: "fs.searchFiles"; cwd: string; query: string; limit?: number };

export type SessionCommand =
	| { type: "prompt"; message: string; images?: ImageInput[]; streamingBehavior?: "steer" | "followUp" }
	| { type: "steer"; message: string; images?: ImageInput[] }
	| { type: "followUp"; message: string; images?: ImageInput[] }
	| { type: "abort" }
	| { type: "clearQueue" }
	| { type: "setModel"; provider: string; modelId: string }
	| { type: "cycleModel" }
	| { type: "setThinkingLevel"; level: ThinkingLevel }
	| { type: "getThinkingLevels" }
	| { type: "setSteeringMode"; mode: QueueMode }
	| { type: "setFollowUpMode"; mode: QueueMode }
	| { type: "compact"; customInstructions?: string }
	| { type: "setApprovalMode"; mode: ApprovalMode }
	| { type: "setAutoCompaction"; enabled: boolean }
	| { type: "setAutoRetry"; enabled: boolean }
	| { type: "abortRetry" }
	| { type: "bash"; command: string; excludeFromContext?: boolean }
	| { type: "abortBash" }
	| { type: "getStats" }
	| { type: "exportHtml"; outputPath?: string }
	| { type: "fork"; entryId: string }
	| { type: "clone" }
	| { type: "getForkMessages" }
	| { type: "getTree" }
	/** Search every entry of the session, including abandoned branches and pre-compaction history. */
	| { type: "search"; query: string; limit?: number }
	| { type: "setName"; name: string }
	| { type: "getCommands" }
	| { type: "getModels" }
	| { type: "ui.response"; response: UiResponse }
	| { type: "refresh" }
	/** Provided by Tau's pi extension (loaded with -e); fail with code pi.extension when it is missing. */
	| { type: "tools.list" }
	| { type: "tools.set"; names: string[] }
	| { type: "navigateTree"; entryId: string; summarize?: boolean }
	/** Reload extensions, skills, prompts and context files in the running session. */
	| { type: "reloadResources" };

export type Command = HostCommand | SessionCommand;

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

export type ClientEnvelope =
	| {
			type: "hello";
			protocolVersion: number;
			clientName?: string /** Required when the host was started with --token. */;
			token?: string;
	  }
	| {
			type: "subscribe";
			sessionId: string /** Last seq the client has seen; the host replays after it or sends a snapshot. */;
			afterSeq?: number;
	  }
	| { type: "unsubscribe"; sessionId: string }
	| { type: "cmd"; id: string; command: HostCommand }
	| { type: "cmd"; id: string; sessionId: string; command: SessionCommand }
	| { type: "ping"; t: number };

export interface CommandError {
	code: string;
	message: string;
}

export type HostEnvelope =
	| { type: "hello"; protocolVersion: number; host: HostInfo }
	/** Sent instead of hello when the token is missing or wrong; the socket is closed afterwards. */
	| { type: "unauthorized"; reason: string }
	| { type: "result"; id: string; ok: true; data?: unknown }
	| { type: "result"; id: string; ok: false; error: CommandError }
	| { type: "session.snapshot"; sessionId: string; seq: number; snapshot: SessionSnapshot }
	| { type: "session.event"; sessionId: string; seq: number; event: SessionEvent }
	| { type: "session.gone"; sessionId: string; reason: string }
	| { type: "sessions.changed" }
	| { type: "auth.prompt"; flowId: string; promptId: string; prompt: AuthPrompt }
	| { type: "auth.event"; flowId: string; event: AuthFlowEvent }
	| {
			type: "auth.done";
			flowId: string;
			ok: boolean;
			error?: string /** True when the client itself cancelled the flow. */;
			cancelled?: boolean;
	  }
	| { type: "terminal.data"; terminalId: string; data: string }
	| { type: "terminal.exit"; terminalId: string; code: number | undefined }
	| { type: "pong"; t: number };

// ---------------------------------------------------------------------------
// Result shapes per command (data field of a successful result)
// ---------------------------------------------------------------------------

export interface HostCommandResults {
	"host.info": HostInfo;
	"sessions.list": SessionSummary[];
	"projects.list": ProjectInfo[];
	/** sessionId is the host handle to subscribe to; it stays stable even when pi forks/clones into a new file. */
	"sessions.create": { sessionId: string };
	"sessions.open": { sessionId: string };
	"sessions.close": null;
	"sessions.delete": null;
	"sessions.preview": {
		messages: Message[];
		leafId?: string;
		cwd?: string;
		model?: { provider: string; modelId: string };
		thinkingLevel?: string;
	};
	"models.list": ModelInfo[];
	"groups.list": GroupsState;
	"groups.create": GroupsState;
	"groups.rename": GroupsState;
	"groups.delete": GroupsState;
	"groups.assign": GroupsState;
	"groups.reorder": GroupsState;
	"groups.renameProject": GroupsState;
	"fs.listDirs": { path: string; dirs: string[] };
	"fs.searchFiles": { files: FileMatch[] };
	"auth.providers": AuthProviderInfo[];
	"auth.login": { flowId: string };
	"auth.answer": null;
	"auth.cancel": null;
	"auth.logout": null;
	"sessions.exportJsonl": { fileName: string; content: string };
	"sessions.import": { sessionId: string; path: string };
	"models.refresh": ModelInfo[];
	"pi.changelog": { version: string; markdown: string };
	"packages.list": PackageEntry[];
	"packages.install": PackageEntry[];
	"packages.remove": PackageEntry[];
	"packages.update": PackageEntry[];
	"resources.list": ResourceOverview;
	"resources.setEnabled": ResourceOverview;
	"settings.patch": ConfigDocument;
	"config.read": ConfigDocument;
	"config.write": ConfigDocument;
	"trust.get": TrustInfo;
	"trust.set": TrustInfo;
	"terminal.open": TerminalInfo;
	"terminal.attach": TerminalInfo;
	"terminal.detach": null;
	"terminal.input": null;
	"terminal.resize": null;
	"terminal.close": null;
	"terminal.list": TerminalInfo[];
}

export interface SessionCommandResults {
	prompt: null;
	steer: null;
	followUp: null;
	abort: null;
	clearQueue: { steering: string[]; followUp: string[] };
	setModel: ModelInfo;
	cycleModel: ModelInfo | null;
	setThinkingLevel: null;
	getThinkingLevels: ThinkingLevel[];
	setSteeringMode: null;
	setFollowUpMode: null;
	compact: { summary: string; tokensBefore: number } | null;
	setApprovalMode: null;
	setAutoCompaction: null;
	setAutoRetry: null;
	abortRetry: null;
	bash: { output: string; exitCode: number | undefined; cancelled: boolean; truncated: boolean };
	abortBash: null;
	getStats: SessionStats;
	/**
	 * The rendered export. Without an `outputPath` the file belongs to the client: `html` is its
	 * content and `fileName` the name to save it under, and nothing is left on the host.
	 */
	exportHtml: { path: string; fileName?: string; html?: string };
	fork: { text: string; cancelled: boolean };
	clone: { cancelled: boolean };
	getForkMessages: ForkMessageInfo[];
	getTree: { tree: TreeNode[]; leafId: string | null };
	search: { matches: SearchMatch[]; truncated: boolean };
	setName: null;
	getCommands: CommandInfo[];
	getModels: ModelInfo[];
	"ui.response": null;
	refresh: null;
	"tools.list": { tools: ToolInfo[]; active: string[] };
	"tools.set": { tools: ToolInfo[]; active: string[] };
	navigateTree: null;
	reloadResources: null;
}

/**
 * Notes for implementers:
 * - A running session is matched to a SessionSummary by comparing `SessionState.sessionFile` with `SessionSummary.path`.
 * - `message.start` is sent only for assistant messages: an empty streaming shell that `block.*` events fill
 *   and `message.end` (same id) replaces. Every other role (user, toolResult, bashExecution, custom, summaries)
 *   arrives complete as a single `message.end`; append it when its id is unknown, replace when known.
 * - Tool results arrive twice: `tool.end` (execution finished, carries the result message) and later
 *   `message.end` with the same toolCallId but a different id. Clients must dedupe by toolCallId.
 * - After every run the host sends `transcript.replace` with pi's durable entry ids; live ids (`live-*`) are temporary.
 */

export function isSessionCommandEnvelope(
	env: ClientEnvelope,
): env is Extract<ClientEnvelope, { type: "cmd"; sessionId: string }> {
	return env.type === "cmd" && "sessionId" in env && typeof env.sessionId === "string";
}

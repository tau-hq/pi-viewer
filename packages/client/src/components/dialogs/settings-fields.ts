import type { ThinkingLevel } from "@pi-tau/shared";
import type { TKey } from "@/i18n";

/**
 * The settings pi's own `/settings` menu offers and that mean something in a browser.
 * Deliberately a closed list: keys pi does not document are left to the Advanced tab.
 */
export type FieldKind = "boolean" | "number" | "text" | "enum" | "tools" | "rows" | "link";

export interface FieldSpec {
	/** Dotted path inside settings.json. */
	path: string;
	kind: FieldKind;
	label: TKey;
	hint: TKey;
	/** Allowed values of an enum field, exactly as pi writes them. */
	options?: readonly string[];
	/** What pi falls back to when neither scope sets the key. */
	fallback?: string | number | boolean;
	/** pi reads this key only from the global file. */
	globalOnly?: boolean;
}

export interface FieldGroup {
	id: string;
	title: TKey;
	fields: readonly FieldSpec[];
}

/** pi's built-in tools, in the order pi lists them. */
export const BUILTIN_TOOLS: readonly string[] = ["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"];

/**
 * The tools worth offering on a given host. pi refuses `powershell` anywhere but Windows, so
 * listing it there would be a switch that cannot do anything; the host filters its own tool
 * list the same way, see session/tau-session.ts.
 */
export function builtinToolsFor(platform: string | undefined): readonly string[] {
	if (platform === undefined || platform === "win32") return BUILTIN_TOOLS;
	return BUILTIN_TOOLS.filter((tool) => tool !== "powershell");
}

export const THINKING_LEVEL_VALUES: readonly ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

const QUEUE_MODES: readonly string[] = ["all", "one-at-a-time"];

export const SETTINGS_GROUPS: readonly FieldGroup[] = [
	{
		id: "behaviour",
		title: "settingsForm.groupBehaviour",
		fields: [
			{
				path: "compaction.enabled",
				kind: "boolean",
				label: "settingsForm.fields.compactionEnabled.label",
				hint: "settingsForm.fields.compactionEnabled.hint",
				fallback: true,
			},
			{
				path: "compaction.reserveTokens",
				kind: "number",
				label: "settingsForm.fields.compactionReserveTokens.label",
				hint: "settingsForm.fields.compactionReserveTokens.hint",
				fallback: 16384,
			},
			{
				path: "compaction.keepRecentTokens",
				kind: "number",
				label: "settingsForm.fields.compactionKeepRecentTokens.label",
				hint: "settingsForm.fields.compactionKeepRecentTokens.hint",
				fallback: 20000,
			},
			{
				path: "retry.enabled",
				kind: "boolean",
				label: "settingsForm.fields.retryEnabled.label",
				hint: "settingsForm.fields.retryEnabled.hint",
				fallback: true,
			},
			{
				path: "retry.maxRetries",
				kind: "number",
				label: "settingsForm.fields.retryMaxRetries.label",
				hint: "settingsForm.fields.retryMaxRetries.hint",
				fallback: 3,
			},
			{
				path: "steeringMode",
				kind: "enum",
				options: QUEUE_MODES,
				label: "settingsForm.fields.steeringMode.label",
				hint: "settingsForm.fields.steeringMode.hint",
				fallback: "one-at-a-time",
			},
			{
				path: "followUpMode",
				kind: "enum",
				options: QUEUE_MODES,
				label: "settingsForm.fields.followUpMode.label",
				hint: "settingsForm.fields.followUpMode.hint",
				fallback: "one-at-a-time",
			},
			{
				path: "enableSkillCommands",
				kind: "boolean",
				label: "settingsForm.fields.enableSkillCommands.label",
				hint: "settingsForm.fields.enableSkillCommands.hint",
				fallback: true,
			},
			{
				path: "defaultProjectTrust",
				kind: "enum",
				options: ["ask", "always", "never"],
				label: "settingsForm.fields.defaultProjectTrust.label",
				hint: "settingsForm.fields.defaultProjectTrust.hint",
				fallback: "ask",
				globalOnly: true,
			},
		],
	},
	{
		id: "models",
		title: "settingsForm.groupModels",
		fields: [
			{
				path: "defaultProvider",
				kind: "text",
				label: "settingsForm.fields.defaultProvider.label",
				hint: "settingsForm.fields.defaultProvider.hint",
			},
			{
				path: "defaultModel",
				kind: "text",
				label: "settingsForm.fields.defaultModel.label",
				hint: "settingsForm.fields.defaultModel.hint",
			},
			{
				path: "defaultThinkingLevel",
				kind: "enum",
				options: THINKING_LEVEL_VALUES,
				label: "settingsForm.fields.defaultThinkingLevel.label",
				hint: "settingsForm.fields.defaultThinkingLevel.hint",
			},
			{
				path: "modelThinkingLevels",
				kind: "rows",
				options: THINKING_LEVEL_VALUES,
				label: "settingsForm.fields.modelThinkingLevels.label",
				hint: "settingsForm.fields.modelThinkingLevels.hint",
			},
			{
				path: "enabledModels",
				kind: "link",
				label: "settingsForm.fields.enabledModels.label",
				hint: "settingsForm.fields.enabledModels.hint",
			},
		],
	},
	{
		id: "connection",
		title: "settingsForm.groupConnection",
		fields: [
			{
				path: "transport",
				kind: "enum",
				options: ["sse", "websocket", "websocket-cached", "auto"],
				label: "settingsForm.fields.transport.label",
				hint: "settingsForm.fields.transport.hint",
				fallback: "auto",
			},
			{
				path: "httpIdleTimeoutMs",
				kind: "number",
				label: "settingsForm.fields.httpIdleTimeoutMs.label",
				hint: "settingsForm.fields.httpIdleTimeoutMs.hint",
				fallback: 300000,
			},
			{
				path: "httpProxy",
				kind: "text",
				label: "settingsForm.fields.httpProxy.label",
				hint: "settingsForm.fields.httpProxy.hint",
			},
			{
				path: "websocketConnectTimeoutMs",
				kind: "number",
				label: "settingsForm.fields.websocketConnectTimeoutMs.label",
				hint: "settingsForm.fields.websocketConnectTimeoutMs.hint",
			},
		],
	},
	{
		id: "display",
		title: "settingsForm.groupDisplay",
		fields: [
			{
				path: "hideThinkingBlock",
				kind: "boolean",
				label: "settingsForm.fields.hideThinkingBlock.label",
				hint: "settingsForm.fields.hideThinkingBlock.hint",
				fallback: false,
			},
			{
				path: "showCacheMissNotices",
				kind: "boolean",
				label: "settingsForm.fields.showCacheMissNotices.label",
				hint: "settingsForm.fields.showCacheMissNotices.hint",
				fallback: false,
			},
			{
				path: "markdown.mermaid",
				kind: "enum",
				options: ["off", "final", "streaming"],
				label: "settingsForm.fields.markdownMermaid.label",
				hint: "settingsForm.fields.markdownMermaid.hint",
				fallback: "streaming",
			},
			{
				path: "images.autoResize",
				kind: "boolean",
				label: "settingsForm.fields.imagesAutoResize.label",
				hint: "settingsForm.fields.imagesAutoResize.hint",
				fallback: true,
			},
			{
				path: "images.blockImages",
				kind: "boolean",
				label: "settingsForm.fields.imagesBlockImages.label",
				hint: "settingsForm.fields.imagesBlockImages.hint",
				fallback: false,
			},
			{
				path: "warnings.vendorExtraUsage",
				kind: "boolean",
				label: "settingsForm.fields.warningsVendorExtraUsage.label",
				hint: "settingsForm.fields.warningsVendorExtraUsage.hint",
				fallback: true,
			},
		],
	},
	{
		id: "tools",
		title: "settingsForm.groupTools",
		fields: [
			{
				path: "defaultTools",
				kind: "tools",
				label: "settingsForm.fields.defaultTools.label",
				hint: "settingsForm.fields.defaultTools.hint",
			},
			{
				path: "shellPath",
				kind: "text",
				label: "settingsForm.fields.shellPath.label",
				hint: "settingsForm.fields.shellPath.hint",
			},
			{
				path: "shellCommandPrefix",
				kind: "text",
				label: "settingsForm.fields.shellCommandPrefix.label",
				hint: "settingsForm.fields.shellCommandPrefix.hint",
			},
			{
				path: "externalEditor",
				kind: "text",
				label: "settingsForm.fields.externalEditor.label",
				hint: "settingsForm.fields.externalEditor.hint",
			},
		],
	},
	{
		id: "sessions",
		title: "settingsForm.groupSessions",
		fields: [
			{
				path: "sessionDir",
				kind: "text",
				label: "settingsForm.fields.sessionDir.label",
				hint: "settingsForm.fields.sessionDir.hint",
			},
		],
	},
];

/** Stable test id and input id for a field row. */
export function fieldId(path: string): string {
	return `setting-${path.replace(/\./g, "-")}`;
}

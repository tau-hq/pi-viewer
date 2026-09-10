/**
 * Tau's pi extension. Loaded into every pi process the Tau host starts (`-e`).
 * It adds what pi's RPC mode lacks, using only pi's public extension API:
 *  - tool approvals through the tool_call hook and ctx.ui.select (rendered by Tau)
 *  - /tau-tree <entryId> [--summarize] for in-session branch navigation
 *  - /tau-tools <requestId> list|set <names> with results returned via appendEntry
 * pi loads TypeScript extensions directly (jiti); keep this file dependency-free.
 */
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Same names as Tau's protocol; TAU_APPROVAL still accepts the old ones. */
type ApprovalMode = "auto" | "acceptEdits" | "manual" | "strict";

const LEGACY: Record<string, ApprovalMode> = {
	none: "auto",
	dangerous: "acceptEdits",
	mutating: "manual",
	all: "strict",
};

const MUTATING_TOOLS = new Set(["bash", "powershell", "write", "edit"]);
const SHELL_TOOLS = new Set(["bash", "powershell"]);
const DANGEROUS_PATTERNS: RegExp[] = [
	/\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*\s|-[a-zA-Z]*[fF][a-zA-Z]*[rR]|--recursive|-r\b)/,
	/\bsudo\b/,
	/\b(chmod|chown)\b[^|;&]*\b777\b/,
	/\bmkfs(\.[a-z0-9]+)?\b/,
	/\bdd\s+if=/,
	/:\(\)\s*\{\s*:\|:&\s*\};:/,
	/\bgit\s+(push\b[^|;&]*(--force|-f\b)|reset\s+--hard|clean\s+-[a-zA-Z]*[fF]|branch\s+-D)/,
	/\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/,
	/\b(shutdown|reboot|poweroff|halt)\b/,
	/\bkill(all)?\s+-9\b/,
	/>\s*\/dev\/sd[a-z]/,
	/\btruncate\b.*\s-s\s*0/,
];

export const APPROVAL_TITLE_PREFIX = "Tau approval";
export const OPTION_ALLOW_ONCE = "Allow once";
export const OPTION_DENY = "Deny";

function isMode(value: string): value is ApprovalMode {
	return value === "auto" || value === "acceptEdits" || value === "manual" || value === "strict";
}

function initialMode(): ApprovalMode {
	const value = process.env.TAU_APPROVAL ?? "manual";
	return isMode(value) ? value : (LEGACY[value] ?? "manual");
}

/** Changed at runtime through /tau-approval so the GUI can switch modes mid-session. */
let mode: ApprovalMode = initialMode();

function describeCall(toolName: string, input: Record<string, unknown>): string {
	if (SHELL_TOOLS.has(toolName) && typeof input.command === "string") return input.command;
	if (typeof input.path === "string") {
		if (toolName === "write" && typeof input.content === "string")
			return `${input.path}\n(${input.content.length} characters)`;
		return input.path;
	}
	const json = JSON.stringify(input);
	return json.length > 600 ? `${json.slice(0, 600)}…` : json;
}

function isDangerous(toolName: string, input: Record<string, unknown>): boolean {
	if (!SHELL_TOOLS.has(toolName) || typeof input.command !== "string") return false;
	const command = input.command;
	return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

export default function tauExtension(pi: ExtensionAPI): void {
	const allowedForSession = new Set<string>();

	pi.on("tool_call", async (event, ctx: ExtensionContext) => {
		if (mode === "auto") return undefined;
		const toolName = event.toolName;
		const input = (event.input ?? {}) as Record<string, unknown>;
		const dangerous = isDangerous(toolName, input);
		const needsApproval =
			mode === "strict" ||
			(mode === "manual" && (MUTATING_TOOLS.has(toolName) || dangerous)) ||
			(mode === "acceptEdits" && dangerous);
		if (!needsApproval) return undefined;
		if (allowedForSession.has(toolName) && !dangerous) return undefined;
		if (!ctx.hasUI) return { block: true, reason: "Tau: no UI available to approve this tool call" };

		const allowTool = `Allow ${toolName} for this session`;
		const title = `${APPROVAL_TITLE_PREFIX}: ${toolName}${dangerous ? " (dangerous)" : ""}\n${describeCall(toolName, input)}`;
		const options = dangerous ? [OPTION_ALLOW_ONCE, OPTION_DENY] : [OPTION_ALLOW_ONCE, allowTool, OPTION_DENY];
		const choice = await ctx.ui.select(title, options);
		if (choice === undefined || choice === OPTION_DENY) return { block: true, reason: "Denied by the user in Tau" };
		if (choice === allowTool) allowedForSession.add(toolName);
		return undefined;
	});

	pi.registerCommand("tau-tree", {
		description: "Tau: navigate to a session tree entry (usage: /tau-tree <entryId> [--summarize])",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const [entryId] = parts;
			if (!entryId) {
				ctx.ui.notify("Usage: /tau-tree <entryId> [--summarize]", "warning");
				return;
			}
			const result = await ctx.navigateTree(entryId, { summarize: parts.includes("--summarize") });
			if (result.cancelled) ctx.ui.notify("Tree navigation was cancelled", "warning");
		},
	});

	pi.registerCommand("tau-approval", {
		description: "Tau: set the approval mode (auto | acceptEdits | manual | strict)",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const [requestId, wanted] = args.trim().split(/\s+/).filter(Boolean);
			if (wanted && isMode(wanted)) {
				mode = wanted;
				allowedForSession.clear();
			} else if (wanted) {
				ctx.ui.notify(`Unknown approval mode: ${wanted}`, "warning");
			}
			pi.appendEntry("tau.approval", { requestId: requestId ?? "", mode });
		},
	});

	pi.registerCommand("tau-reload", {
		description: "Tau: reload extensions, skills, prompts and context files",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			await ctx.reload();
			ctx.ui.notify("Reloaded extensions, skills and prompts", "info");
		},
	});

	pi.registerCommand("tau-tools", {
		description: "Tau: list or set active tools (usage: /tau-tools <requestId> list | set <name,name,...>)",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const [requestId, action, names] = parts;
			if (!requestId || !action) {
				ctx.ui.notify("Usage: /tau-tools <requestId> list | set <names>", "warning");
				return;
			}
			if (action === "set") {
				const wanted = (names ?? "")
					.split(",")
					.map((n) => n.trim())
					.filter(Boolean);
				pi.setActiveTools(wanted);
			}
			const active = pi.getActiveTools();
			const activeSet = new Set(active);
			const all = pi
				.getAllTools()
				.map((tool) => ({ name: tool.name, description: tool.description, active: activeSet.has(tool.name) }));
			pi.appendEntry("tau.tools", { requestId, tools: all, active });
		},
	});
}

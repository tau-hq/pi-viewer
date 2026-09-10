/**
 * Tool approvals arrive as ordinary `select` requests from Tau's pi extension. The title's first
 * line is "Tau approval: <tool> [(dangerous)]", the remaining lines describe the call.
 */

export const APPROVAL_PREFIX = "Tau approval";

export interface TitleParts {
	heading: string;
	/** Lines after the first one, shown as a code block. */
	detail: string | undefined;
}

export function splitTitle(title: string): TitleParts {
	const index = title.indexOf("\n");
	if (index < 0) return { heading: title.trim(), detail: undefined };
	const detail = title.slice(index + 1).replace(/\s+$/, "");
	return { heading: title.slice(0, index).trim(), detail: detail.length > 0 ? detail : undefined };
}

export interface ApprovalInfo {
	toolName: string;
	dangerous: boolean;
}

export function parseApproval(heading: string): ApprovalInfo | undefined {
	if (!heading.startsWith(APPROVAL_PREFIX)) return undefined;
	const rest = heading
		.slice(APPROVAL_PREFIX.length)
		.replace(/^\s*:\s*/, "")
		.trim();
	const dangerous = /\(dangerous\)$/i.test(rest);
	const toolName = rest.replace(/\s*\(dangerous\)$/i, "").trim();
	return { toolName: toolName || "tool", dangerous };
}

export type ShortcutKey = "a" | "s" | "d";

/** Option text per shortcut key; missing keys have no matching option. */
export type ApprovalShortcuts = Partial<Record<ShortcutKey, string>>;

export function approvalShortcuts(options: readonly string[]): ApprovalShortcuts {
	const shortcuts: ApprovalShortcuts = {};
	const allowOnce = options.find((option) => /^allow once$/i.test(option.trim()));
	const allowSession = options.find((option) => /^allow .+ for this session$/i.test(option.trim()));
	const deny = options.find((option) => /^deny$/i.test(option.trim()));
	if (allowOnce !== undefined) shortcuts.a = allowOnce;
	if (allowSession !== undefined) shortcuts.s = allowSession;
	if (deny !== undefined) shortcuts.d = deny;
	return shortcuts;
}

export function shortcutFor(option: string, shortcuts: ApprovalShortcuts): ShortcutKey | undefined {
	for (const key of ["a", "s", "d"] as const) {
		if (shortcuts[key] === option) return key;
	}
	return undefined;
}

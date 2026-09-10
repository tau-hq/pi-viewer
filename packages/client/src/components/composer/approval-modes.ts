import type { ApprovalMode } from "@pi-tau/shared";
import type { TKey } from "@/i18n";

/** Menu order, and the order Shift+Tab walks through. */
export const APPROVAL_MODES = ["auto", "acceptEdits", "manual", "strict"] as const satisfies readonly ApprovalMode[];

/** What pi falls back to when no mode is known. */
export const DEFAULT_APPROVAL_MODE: ApprovalMode = "manual";

/** Title and one-line description of every mode. */
export const APPROVAL_MODE_TEXT: Record<ApprovalMode, { title: TKey; description: TKey }> = {
	auto: { title: "mode.auto", description: "mode.autoDescription" },
	acceptEdits: { title: "mode.acceptEdits", description: "mode.acceptEditsDescription" },
	manual: { title: "mode.manual", description: "mode.manualDescription" },
	strict: { title: "mode.strict", description: "mode.strictDescription" },
};

/** The mode `steps` positions after `current`, wrapping around; an unknown mode lands on the default. */
export function nextApprovalMode(current: ApprovalMode | undefined, steps = 1): ApprovalMode {
	const index = current === undefined ? -1 : APPROVAL_MODES.indexOf(current);
	if (index < 0) return DEFAULT_APPROVAL_MODE;
	const size = APPROVAL_MODES.length;
	return APPROVAL_MODES[(((index + steps) % size) + size) % size] ?? DEFAULT_APPROVAL_MODE;
}

/** Mode a number key picks while the menu is open ("1" is the first entry). */
export function approvalModeForKey(key: string): ApprovalMode | undefined {
	if (!/^[0-9]$/.test(key)) return undefined;
	return APPROVAL_MODES[Number(key) - 1];
}

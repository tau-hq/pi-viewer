import type { SessionSummary } from "@pi-tau/shared";
import type { TKey } from "@/i18n";

/**
 * State of the circle left of a session name. Five values, and the first match wins:
 * a problem beats work in progress, and work in progress beats "there is something new".
 */
export type SessionStatus = "error" | "needsInput" | "working" | "unseen" | "seen";

/** Priority order; also the order the legend lists them in. */
export const SESSION_STATUSES: readonly SessionStatus[] = ["error", "needsInput", "working", "unseen", "seen"];

export const SESSION_STATUS_LABEL: Record<SessionStatus, TKey> = {
	error: "sessionStatus.error",
	needsInput: "sessionStatus.needsInput",
	working: "sessionStatus.working",
	unseen: "sessionStatus.unseen",
	seen: "sessionStatus.seen",
};

/**
 * What this client's live view of a session adds to its list entry. The host reports the same
 * three flags in both places, but the subscription is immediate while the list is refreshed on
 * a debounce, and only the live view knows about dialogs waiting in this browser.
 */
export interface LiveSessionStatus {
	/** A `!` shell command is running; the session is busy even though no model call is. */
	bashRunning?: boolean;
	isStreaming: boolean;
	needsInput: boolean;
	lastRunFailed: boolean;
	/** Extension dialogs (tool approvals included) waiting for an answer. */
	pendingUi: number;
}

/**
 * Pure state decision for one row.
 *
 * `seenAt` is the `modified` timestamp the user last looked at, or undefined for a session this
 * browser has never shown — which counts as seen, so an existing list does not light up as a
 * whole the first time someone opens Tau.
 */
export function sessionStatus(
	summary: SessionSummary,
	live: LiveSessionStatus | undefined,
	seenAt: number | undefined,
): SessionStatus {
	if (summary.failed === true || live?.lastRunFailed === true) return "error";
	if (summary.needsInput === true || live?.needsInput === true || (live?.pendingUi ?? 0) > 0) return "needsInput";
	if (summary.isStreaming || (live?.isStreaming || live?.bashRunning) === true) return "working";
	if (seenAt === undefined || seenAt >= summary.modified) return "seen";
	return "unseen";
}

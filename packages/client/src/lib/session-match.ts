import type { SessionSummary } from "@pi-tau/shared";

/** The host lists sessions whose file pi has not written yet under this prefix. */
const PENDING_PREFIX = "pending:";

export function isPendingPath(path: string): boolean {
	return path.startsWith(PENDING_PREFIX);
}

function normalizePath(path: string): string {
	return path.replace(/[/\\]+$/, "");
}

export function samePath(a: string | undefined, b: string | undefined): boolean {
	return a !== undefined && b !== undefined && normalizePath(a) === normalizePath(b);
}

/**
 * True when a listed session is the one currently on screen.
 *
 * `SessionSummary.id` is pi's session id, which equals the host handle only for the file a
 * session started with: clone and fork make pi write a new file while the host keeps the
 * handle. The session file therefore wins whenever the host has reported one.
 */
export function isActiveSummary(
	summary: SessionSummary,
	currentSessionId: string | undefined,
	activeSessionFile: string | undefined,
): boolean {
	if (currentSessionId === undefined) return false;
	if (activeSessionFile !== undefined && !isPendingPath(summary.path)) return samePath(summary.path, activeSessionFile);
	return summary.id === currentSessionId;
}

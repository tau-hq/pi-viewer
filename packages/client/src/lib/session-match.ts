import type { SessionSummary } from "@pi-tau/shared";
import { t } from "@/i18n";

/** The host lists sessions whose file pi has not written yet under this prefix. */
const PENDING_PREFIX = "pending:";

/** What a session is called in a list: its name, else its first message, else a placeholder. */
export function sessionLabel(session: SessionSummary): string {
	return session.name?.trim() || session.firstMessage.trim().replace(/\s+/g, " ") || t("sidebar.untitled");
}

/** Every whitespace-separated term of `query` has to appear in name, first message or directory. */
export function matchesQuery(session: SessionSummary, query: string): boolean {
	if (!query) return true;
	const haystack = `${session.name ?? ""}\n${session.firstMessage}\n${session.cwd}`.toLowerCase();
	return query
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.every((term) => haystack.includes(term));
}

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

import type { ProjectInfo, SessionSummary } from "@pi-tau/shared";
import { basename } from "@/lib/format";
import { matchesQuery } from "../dialogs/QuickSwitcher";

export interface SessionGroup {
	cwd: string;
	name: string;
	sessions: SessionSummary[];
}

/** Sessions grouped by project (most recently modified first); unknown cwds get their own group. */
export function groupSessions(projects: ProjectInfo[], sessions: SessionSummary[], query: string): SessionGroup[] {
	const byCwd = new Map<string, SessionSummary[]>();
	for (const session of sessions) {
		if (!matchesQuery(session, query)) continue;
		const list = byCwd.get(session.cwd);
		if (list) list.push(session);
		else byCwd.set(session.cwd, [session]);
	}
	const groups: SessionGroup[] = [];
	for (const project of projects) {
		const list = byCwd.get(project.cwd);
		if (!list) continue;
		byCwd.delete(project.cwd);
		groups.push({ cwd: project.cwd, name: project.name || basename(project.cwd), sessions: list });
	}
	for (const [cwd, list] of byCwd) {
		groups.push({ cwd, name: basename(cwd) || cwd, sessions: list });
	}
	return groups;
}

import type { ProjectInfo, SessionGroup, SessionSummary } from "@pi-tau/shared";
import { basename } from "@/lib/format";
import { matchesQuery } from "@/lib/session-match";

/**
 * One block of rows in the sidebar. A block is either a group the user made, which comes first
 * and keeps the order the user gave it, or a project directory, which is what every session
 * without a group falls back to.
 */
export interface SidebarGroup {
	kind: "user" | "project";
	/** Stable across renders; keys the React list, the collapsed state and the drop target. */
	key: string;
	name: string;
	/** Set for a user group, and the only thing the host needs to file a session under it. */
	groupId?: string;
	/** Set for a project group: the working directory the sessions share. */
	cwd?: string;
	/** True when the name is the user's, not the folder's; only then can it be reset. */
	named?: boolean;
	sessions: SessionSummary[];
}

export function userGroupKey(groupId: string): string {
	return `group:${groupId}`;
}

export function projectGroupKey(cwd: string): string {
	return `project:${cwd}`;
}

/**
 * The sidebar list: the user's groups in their own order, then a project group per directory
 * for every session that is not filed under one.
 *
 * `query` filters the sessions, not the groups: an empty user group stays visible while nobody
 * is searching (it is a drop target), and disappears while a search is running, exactly like a
 * project group without a match. A `groupId` no group answers for is ignored rather than
 * dropped, so a session can never vanish from the list.
 */
export function buildSidebarGroups(
	groups: SessionGroup[],
	projectNames: Record<string, string>,
	projects: ProjectInfo[],
	sessions: SessionSummary[],
	query: string,
): SidebarGroup[] {
	const known = new Set(groups.map((group) => group.id));
	const byGroup = new Map<string, SessionSummary[]>();
	const byCwd = new Map<string, SessionSummary[]>();
	for (const session of sessions) {
		if (!matchesQuery(session, query)) continue;
		const groupId = session.groupId !== undefined && known.has(session.groupId) ? session.groupId : undefined;
		const bucket = groupId === undefined ? byCwd : byGroup;
		const key = groupId ?? session.cwd;
		const list = bucket.get(key);
		if (list) list.push(session);
		else bucket.set(key, [session]);
	}

	const out: SidebarGroup[] = [];
	for (const group of [...groups].sort((a, b) => a.order - b.order)) {
		const list = byGroup.get(group.id) ?? [];
		if (list.length === 0 && query !== "") continue;
		out.push({ kind: "user", key: userGroupKey(group.id), name: group.name, groupId: group.id, sessions: list });
	}
	// Projects come in the order the host sorted them (most recently modified first).
	for (const project of projects) {
		const list = byCwd.get(project.cwd);
		if (!list) continue;
		byCwd.delete(project.cwd);
		const given = projectNames[project.cwd];
		out.push({
			kind: "project",
			key: projectGroupKey(project.cwd),
			name: given ?? (project.name || basename(project.cwd)),
			cwd: project.cwd,
			...(given === undefined ? {} : { named: true }),
			sessions: list,
		});
	}
	// A directory the project list does not mention still gets its own group.
	for (const [cwd, list] of byCwd) {
		const given = projectNames[cwd];
		out.push({
			kind: "project",
			key: projectGroupKey(cwd),
			name: given ?? (basename(cwd) || cwd),
			cwd,
			...(given === undefined ? {} : { named: true }),
			sessions: list,
		});
	}
	return out;
}

/**
 * Group ids in the order a "move up"/"move down" leaves them, or undefined when the group
 * already sits at that end and nothing would change.
 */
export function movedGroupOrder(groups: SessionGroup[], id: string, direction: "up" | "down"): string[] | undefined {
	const ids = [...groups].sort((a, b) => a.order - b.order).map((group) => group.id);
	const index = ids.indexOf(id);
	if (index < 0) return undefined;
	const target = direction === "up" ? index - 1 : index + 1;
	if (target < 0 || target >= ids.length) return undefined;
	const swapped = ids[target];
	if (swapped === undefined) return undefined;
	ids[target] = id;
	ids[index] = swapped;
	return ids;
}

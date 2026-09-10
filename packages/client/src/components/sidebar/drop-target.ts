import type { SessionSummary } from "@pi-tau/shared";
import { isPendingPath } from "@/lib/session-match";

/** What sits under the pointer while a session row is being dragged. */
export type DropTarget =
	/** A group the user made: the drop files the session under it. */
	| { kind: "user"; groupId: string }
	/** A project group: the drop takes the session out of its group again. */
	| { kind: "project" };

/** The `groups.assign` a drop should send. */
export interface DropAssignment {
	sessionPath: string;
	/** null puts the session back under its project. */
	groupId: string | null;
}

/**
 * What dropping `session` on `target` does, or undefined when the drop would change nothing —
 * the group it already sits in, a project group it is already grouped by, or a session whose
 * file pi has not written yet, which has no path the host could file.
 *
 * A session's project is its working directory and cannot be dragged: a drop on a project
 * group only ever clears the group.
 */
export function dropAssignment(
	session: Pick<SessionSummary, "path" | "groupId">,
	target: DropTarget,
): DropAssignment | undefined {
	if (isPendingPath(session.path)) return undefined;
	if (target.kind === "project") {
		return session.groupId === undefined ? undefined : { sessionPath: session.path, groupId: null };
	}
	if (session.groupId === target.groupId) return undefined;
	return { sessionPath: session.path, groupId: target.groupId };
}

/** Whether the group under the pointer should light up as a drop target. */
export function canDrop(session: Pick<SessionSummary, "path" | "groupId"> | undefined, target: DropTarget): boolean {
	return session !== undefined && dropAssignment(session, target) !== undefined;
}

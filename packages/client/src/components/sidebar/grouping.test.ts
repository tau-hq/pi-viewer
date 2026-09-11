import type { ProjectInfo, SessionGroup, SessionSummary } from "@pi-tau/shared";
import { describe, expect, it } from "vitest";
import { buildSidebarGroups, movedGroupOrder, projectGroupKey, userGroupKey } from "./grouping";

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		id,
		path: `/root/.pi/${id}.jsonl`,
		cwd: "/srv/pi-tau",
		created: 1000,
		modified: 2000,
		messageCount: 2,
		firstMessage: `first message of ${id}`,
		running: false,
		isStreaming: false,
		...overrides,
	};
}

function project(cwd: string, name = ""): ProjectInfo {
	return { cwd, name, sessionCount: 1, lastModified: 3000, exists: true };
}

function group(id: string, name: string, order: number): SessionGroup {
	return { id, name, order };
}

/** The names given to project folders are their own argument; most tests do not use them. */
function build(
	groups: SessionGroup[],
	projects: ProjectInfo[],
	sessions: SessionSummary[],
	query: string,
	projectNames: Record<string, string> = {},
) {
	return buildSidebarGroups(groups, projectNames, projects, sessions, query);
}

describe("buildSidebarGroups", () => {
	it("puts the user's groups first, in their own order, and the projects after them", () => {
		const groups = [group("g2", "Later", 1), group("g1", "Sooner", 0)];
		const sessions = [
			summary("a", { groupId: "g1" }),
			summary("b", { groupId: "g2" }),
			summary("c", { cwd: "/srv/other" }),
		];
		const built = build(groups, [project("/srv/pi-tau"), project("/srv/other")], sessions, "");
		expect(built.map((entry) => entry.name)).toEqual(["Sooner", "Later", "other"]);
		expect(built.map((entry) => entry.kind)).toEqual(["user", "user", "project"]);
		expect(built[0]?.sessions.map((s) => s.id)).toEqual(["a"]);
		expect(built[2]?.sessions.map((s) => s.id)).toEqual(["c"]);
	});

	it("shows the name the user gave a project and marks it as given", () => {
		const built = build([], [project("/srv/pi-tau")], [summary("a")], "", { "/srv/pi-tau": "Tau" });
		expect(built[0]?.name).toBe("Tau");
		expect(built[0]?.named).toBe(true);
		// Without a name of its own the folder name stands, and there is nothing to reset.
		const plain = build([], [project("/srv/pi-tau")], [summary("a")], "");
		expect(plain[0]?.name).toBe("pi-tau");
		expect(plain[0]?.named).toBeUndefined();
	});

	it("names a directory the project list does not mention", () => {
		const built = build([], [], [summary("a", { cwd: "/srv/other" })], "", { "/srv/other": "Elsewhere" });
		expect(built[0]?.name).toBe("Elsewhere");
		expect(built[0]?.named).toBe(true);
	});

	it("keys a user group by its id and a project group by its directory", () => {
		const built = build([group("g1", "Work", 0)], [project("/srv/pi-tau")], [summary("a")], "");
		expect(built.map((entry) => entry.key)).toEqual([userGroupKey("g1"), projectGroupKey("/srv/pi-tau")]);
		expect(built[0]?.groupId).toBe("g1");
		expect(built[0]?.cwd).toBeUndefined();
		expect(built[1]?.cwd).toBe("/srv/pi-tau");
		expect(built[1]?.groupId).toBeUndefined();
	});

	it("shows an empty user group while nobody is searching", () => {
		const built = build([group("g1", "Empty", 0)], [], [], "");
		expect(built).toHaveLength(1);
		expect(built[0]?.sessions).toEqual([]);
	});

	it("hides an empty group while a search runs, exactly like a project without a match", () => {
		const sessions = [summary("a", { groupId: "g1", name: "alpha" }), summary("b", { name: "beta" })];
		const built = build([group("g1", "Work", 0)], [project("/srv/pi-tau")], sessions, "beta");
		expect(built.map((entry) => entry.name)).toEqual(["pi-tau"]);
		expect(built[0]?.sessions.map((s) => s.id)).toEqual(["b"]);
	});

	it("filters inside a group, and every term has to match", () => {
		const sessions = [
			summary("a", { groupId: "g1", name: "alpha one" }),
			summary("b", { groupId: "g1", name: "alpha two" }),
		];
		const built = build([group("g1", "Work", 0)], [], sessions, "alpha two");
		expect(built[0]?.sessions.map((s) => s.id)).toEqual(["b"]);
	});

	it("keeps a session whose group is gone, under its project", () => {
		const built = build([], [project("/srv/pi-tau")], [summary("a", { groupId: "stale" })], "");
		expect(built.map((entry) => entry.kind)).toEqual(["project"]);
		expect(built[0]?.sessions.map((s) => s.id)).toEqual(["a"]);
	});

	it("gives a directory the project list does not mention its own group", () => {
		const built = build([], [], [summary("a", { cwd: "/srv/elsewhere/deep" })], "");
		expect(built.map((entry) => entry.name)).toEqual(["deep"]);
		expect(built[0]?.cwd).toBe("/srv/elsewhere/deep");
	});

	it("names a project after the host's name, falling back to the directory", () => {
		const built = build([], [project("/srv/pi-tau", "pi-tau GUI")], [summary("a")], "");
		expect(built[0]?.name).toBe("pi-tau GUI");
		const unnamed = build([], [project("/srv/pi-tau")], [summary("a")], "");
		expect(unnamed[0]?.name).toBe("pi-tau");
	});

	it("keeps the order the session list came in", () => {
		const sessions = [
			summary("new", { groupId: "g1", modified: 5000 }),
			summary("old", { groupId: "g1", modified: 1000 }),
		];
		const built = build([group("g1", "Work", 0)], [], sessions, "");
		expect(built[0]?.sessions.map((s) => s.id)).toEqual(["new", "old"]);
	});
});

describe("movedGroupOrder", () => {
	const groups = [group("a", "A", 0), group("b", "B", 1), group("c", "C", 2)];

	it("swaps a group with its neighbour", () => {
		expect(movedGroupOrder(groups, "b", "up")).toEqual(["b", "a", "c"]);
		expect(movedGroupOrder(groups, "b", "down")).toEqual(["a", "c", "b"]);
	});

	it("leaves the ends alone", () => {
		expect(movedGroupOrder(groups, "a", "up")).toBeUndefined();
		expect(movedGroupOrder(groups, "c", "down")).toBeUndefined();
	});

	it("sorts by order first, whatever order the list arrives in", () => {
		const shuffled = [group("c", "C", 2), group("a", "A", 0), group("b", "B", 1)];
		expect(movedGroupOrder(shuffled, "c", "up")).toEqual(["a", "c", "b"]);
	});

	it("says nothing about a group it does not know", () => {
		expect(movedGroupOrder(groups, "gone", "up")).toBeUndefined();
	});
});

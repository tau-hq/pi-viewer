import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "tau-groups-"));
process.env.TAU_DATA_DIR = dir;

const {
	assignments,
	assignSession,
	createGroup,
	deleteGroup,
	listGroups,
	pruneAssignments,
	renameGroup,
	reorderGroups,
	setProjectName,
} = await import("../src/groups.js");

const file = join(dir, "groups.json");

beforeEach(() => {
	writeFileSync(file, JSON.stringify({ version: 1, groups: [], assignments: {} }));
});

describe("session groups", () => {
	it("creates, renames and orders groups", () => {
		const a = createGroup("  Work   stuff ").groups[0];
		expect(a?.name).toBe("Work stuff");
		createGroup("Personal");
		const third = createGroup("Archive").groups;
		expect(third.map((g) => g.name)).toEqual(["Work stuff", "Personal", "Archive"]);
		expect(third.map((g) => g.order)).toEqual([0, 1, 2]);

		const ids = third.map((g) => g.id);
		const reordered = reorderGroups([ids[2] as string, ids[0] as string]).groups;
		expect(reordered.map((g) => g.name)).toEqual(["Archive", "Work stuff", "Personal"]);
		expect(reordered.map((g) => g.order)).toEqual([0, 1, 2]);

		renameGroup(ids[1] as string, "Private");
		expect(listGroups().groups.find((g) => g.id === ids[1])?.name).toBe("Private");
		expect(() => renameGroup("nope", "x")).toThrow(/no such group/);
		expect(() => createGroup("   ")).toThrow(/needs a name/);
	});

	it("assigns sessions and lets them fall back when the group goes", () => {
		const group = createGroup("Work").groups[0];
		if (!group) throw new Error("no group");
		assignSession("/root/.pi/a.jsonl", group.id);
		expect(assignments()["/root/.pi/a.jsonl"]).toBe(group.id);
		assignSession("/root/.pi/a.jsonl", null);
		expect(assignments()["/root/.pi/a.jsonl"]).toBeUndefined();

		assignSession("/root/.pi/b.jsonl", group.id);
		deleteGroup(group.id);
		expect(listGroups().groups).toEqual([]);
		expect(assignments()).toEqual({});
		expect(() => assignSession("/root/.pi/c.jsonl", "gone")).toThrow(/no such group/);
	});

	it("prunes assignments of sessions that no longer exist", () => {
		const group = createGroup("Work").groups[0];
		if (!group) throw new Error("no group");
		assignSession("/root/.pi/keep.jsonl", group.id);
		assignSession("/root/.pi/gone.jsonl", group.id);
		pruneAssignments(new Set(["/root/.pi/keep.jsonl"]));
		expect(Object.keys(assignments())).toEqual(["/root/.pi/keep.jsonl"]);
	});

	it("starts empty when the file is damaged and never throws at the caller", () => {
		writeFileSync(file, "{not json");
		expect(listGroups().groups).toEqual([]);
		const group = createGroup("Fresh").groups[0];
		expect(group?.name).toBe("Fresh");
		expect(JSON.parse(readFileSync(file, "utf8")).groups).toHaveLength(1);
	});

	it("names a project directory and gives the name back until it is dropped", () => {
		const named = setProjectName("/srv/pi-tau/", "  Tau   work ");
		expect(named.projectNames["/srv/pi-tau"]).toBe("Tau work");
		// A name belongs to the directory, not to a group, so no group was created for it.
		expect(named.groups).toEqual([]);
		expect(listGroups().projectNames["/srv/pi-tau"]).toBe("Tau work");
		expect(setProjectName("/srv/pi-tau", null).projectNames).toEqual({});
		expect(() => setProjectName("/srv/pi-tau", "   ")).toThrow(/needs a name/);
	});

	it("drops assignments pointing at groups that are not in the file", () => {
		writeFileSync(file, JSON.stringify({ version: 1, groups: [], assignments: { "/x.jsonl": "ghost" } }));
		expect(assignments()).toEqual({});
	});
});

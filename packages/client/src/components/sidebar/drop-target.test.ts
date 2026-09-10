import { describe, expect, it } from "vitest";
import { canDrop, dropAssignment } from "./drop-target";

const filed = { path: "/root/.pi/a.jsonl", groupId: "g1" };
const loose = { path: "/root/.pi/b.jsonl" };

describe("dropAssignment", () => {
	it("files a session under the group it was dropped on", () => {
		expect(dropAssignment(loose, { kind: "user", groupId: "g1" })).toEqual({
			sessionPath: loose.path,
			groupId: "g1",
		});
	});

	it("moves a session from one group to another", () => {
		expect(dropAssignment(filed, { kind: "user", groupId: "g2" })).toEqual({
			sessionPath: filed.path,
			groupId: "g2",
		});
	});

	it("takes a session out of its group when it lands on a project", () => {
		expect(dropAssignment(filed, { kind: "project" })).toEqual({ sessionPath: filed.path, groupId: null });
	});

	it("does nothing when the drop changes nothing", () => {
		// The group it already sits in.
		expect(dropAssignment(filed, { kind: "user", groupId: "g1" })).toBeUndefined();
		// A project group is where a session without a group already is.
		expect(dropAssignment(loose, { kind: "project" })).toBeUndefined();
	});

	it("refuses a session whose file pi has not written yet", () => {
		const pending = { path: "pending:handle-1" };
		expect(dropAssignment(pending, { kind: "user", groupId: "g1" })).toBeUndefined();
		expect(dropAssignment(pending, { kind: "project" })).toBeUndefined();
	});
});

describe("canDrop", () => {
	it("lights up only the groups a drop would change", () => {
		expect(canDrop(loose, { kind: "user", groupId: "g1" })).toBe(true);
		expect(canDrop(filed, { kind: "user", groupId: "g1" })).toBe(false);
		expect(canDrop(filed, { kind: "project" })).toBe(true);
	});

	it("stays quiet while nothing is being dragged", () => {
		expect(canDrop(undefined, { kind: "user", groupId: "g1" })).toBe(false);
		expect(canDrop(undefined, { kind: "project" })).toBe(false);
	});
});

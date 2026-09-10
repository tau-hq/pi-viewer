import type { SessionSummary } from "@pi-tau/shared";
import { describe, expect, it } from "vitest";
import { resolveDeferred } from "./groups-store";

function summary(overrides: Partial<SessionSummary>): SessionSummary {
	return {
		id: "pi-1",
		path: "/root/.pi/a.jsonl",
		cwd: "/srv/pi-tau",
		created: 1000,
		modified: 2000,
		messageCount: 0,
		firstMessage: "",
		running: true,
		isStreaming: false,
		...overrides,
	};
}

describe("resolveDeferred", () => {
	it("sends the assignment once pi has written the session file", () => {
		const sessions = [summary({ handle: "h1", path: "/root/.pi/written.jsonl" })];
		expect(resolveDeferred({ h1: "g1" }, sessions)).toEqual({
			ready: [{ handle: "h1", sessionPath: "/root/.pi/written.jsonl", groupId: "g1" }],
			stale: [],
		});
	});

	it("keeps waiting while the session has no file", () => {
		const sessions = [summary({ handle: "h1", path: "pending:h1" })];
		expect(resolveDeferred({ h1: "g1" }, sessions)).toEqual({ ready: [], stale: [] });
	});

	it("drops the wait when the host does not list the session any more", () => {
		expect(resolveDeferred({ h1: "g1" }, [])).toEqual({ ready: [], stale: ["h1"] });
	});

	it("matches a session without a handle by its own id", () => {
		const sessions = [summary({ id: "pi-9", path: "/root/.pi/nine.jsonl" })];
		expect(resolveDeferred({ "pi-9": "g2" }, sessions).ready).toEqual([
			{ handle: "pi-9", sessionPath: "/root/.pi/nine.jsonl", groupId: "g2" },
		]);
	});

	it("handles several waits at once", () => {
		const sessions = [
			summary({ handle: "h1", path: "/root/.pi/one.jsonl" }),
			summary({ handle: "h2", path: "pending:h2" }),
		];
		const result = resolveDeferred({ h1: "g1", h2: "g1", h3: "g2" }, sessions);
		expect(result.ready.map((entry) => entry.handle)).toEqual(["h1"]);
		expect(result.stale).toEqual(["h3"]);
	});
});

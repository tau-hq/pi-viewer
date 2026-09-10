import type { SessionSummary } from "@pi-tau/shared";
import { describe, expect, it } from "vitest";
import { isActiveSummary, isPendingPath, samePath } from "./session-match";

function summary(id: string, path: string): SessionSummary {
	return {
		id,
		path,
		cwd: "/srv/pi-tau",
		created: 0,
		modified: 0,
		messageCount: 0,
		firstMessage: "",
		running: true,
		isStreaming: false,
	};
}

describe("isActiveSummary", () => {
	const original = summary("handle-1", "/root/.pi/a.jsonl");
	const cloned = summary("pi-2", "/root/.pi/b.jsonl");

	it("matches by id while the host has not reported a file", () => {
		expect(isActiveSummary(original, "handle-1", undefined)).toBe(true);
		expect(isActiveSummary(cloned, "handle-1", undefined)).toBe(false);
	});

	it("follows the session file after a clone, and drops the old file", () => {
		expect(isActiveSummary(cloned, "handle-1", "/root/.pi/b.jsonl")).toBe(true);
		expect(isActiveSummary(original, "handle-1", "/root/.pi/b.jsonl")).toBe(false);
	});

	it("ignores a trailing slash and keeps pending entries on the id", () => {
		expect(isActiveSummary(cloned, "handle-1", "/root/.pi/b.jsonl/")).toBe(true);
		const pending = summary("handle-1", "pending:handle-1");
		expect(isActiveSummary(pending, "handle-1", "/root/.pi/b.jsonl")).toBe(true);
	});

	it("highlights nothing without a session", () => {
		expect(isActiveSummary(original, undefined, undefined)).toBe(false);
	});
});

describe("path helpers", () => {
	it("recognizes pending paths", () => {
		expect(isPendingPath("pending:handle-1")).toBe(true);
		expect(isPendingPath("/root/.pi/a.jsonl")).toBe(false);
	});

	it("compares paths defensively", () => {
		expect(samePath("/a/b", "/a/b/")).toBe(true);
		expect(samePath(undefined, "/a/b")).toBe(false);
		expect(samePath("/a/b", undefined)).toBe(false);
	});
});

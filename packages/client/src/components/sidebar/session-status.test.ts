import type { SessionSummary } from "@pi-tau/shared";
import { describe, expect, it } from "vitest";
import { type LiveSessionStatus, SESSION_STATUSES, sessionStatus } from "./session-status";

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		id: "s1",
		path: "/root/.pi/a.jsonl",
		cwd: "/srv/pi-tau",
		created: 1000,
		modified: 2000,
		messageCount: 4,
		firstMessage: "hi",
		running: false,
		isStreaming: false,
		...overrides,
	};
}

function live(overrides: Partial<LiveSessionStatus> = {}): LiveSessionStatus {
	return {
		isStreaming: false,
		needsInput: false,
		bashRunning: false,
		lastRunFailed: false,
		pendingUi: 0,
		...overrides,
	};
}

describe("sessionStatus", () => {
	it("reads the five states off the list entry alone", () => {
		expect(sessionStatus(summary({ failed: true }), undefined, undefined)).toBe("error");
		expect(sessionStatus(summary({ needsInput: true }), undefined, undefined)).toBe("needsInput");
		expect(sessionStatus(summary({ isStreaming: true }), undefined, undefined)).toBe("working");
		expect(sessionStatus(summary(), undefined, 1000)).toBe("unseen");
		expect(sessionStatus(summary(), undefined, 2000)).toBe("seen");
	});

	it("reads them off the live view of an open session", () => {
		expect(sessionStatus(summary(), live({ lastRunFailed: true }), 2000)).toBe("error");
		expect(sessionStatus(summary(), live({ needsInput: true }), 2000)).toBe("needsInput");
		expect(sessionStatus(summary(), live({ isStreaming: true }), 2000)).toBe("working");
		expect(sessionStatus(summary(), live(), 2000)).toBe("seen");
	});

	it("treats a dialog waiting in this browser as needing input", () => {
		expect(sessionStatus(summary(), live({ pendingUi: 1 }), 2000)).toBe("needsInput");
		// A pending dialog outranks a run that is still going.
		expect(sessionStatus(summary(), live({ pendingUi: 2, isStreaming: true }), 2000)).toBe("needsInput");
	});

	it("keeps the priority order: error, needs input, working, unseen, seen", () => {
		const everything = summary({ failed: true, needsInput: true, isStreaming: true, modified: 3000 });
		expect(sessionStatus(everything, live({ lastRunFailed: true, needsInput: true, isStreaming: true }), 1)).toBe(
			"error",
		);
		expect(sessionStatus(summary({ needsInput: true, isStreaming: true, modified: 3000 }), undefined, 1)).toBe(
			"needsInput",
		);
		expect(sessionStatus(summary({ isStreaming: true, modified: 3000 }), undefined, 1)).toBe("working");
		expect(sessionStatus(summary({ modified: 3000 }), undefined, 1)).toBe("unseen");
		// The union and the legend list agree with that order.
		expect(SESSION_STATUSES).toEqual(["error", "needsInput", "working", "unseen", "seen"]);
	});

	it("counts an unknown session as seen, whatever its timestamps say", () => {
		expect(sessionStatus(summary({ modified: Date.now() }), undefined, undefined)).toBe("seen");
		expect(sessionStatus(summary({ modified: 0 }), live(), undefined)).toBe("seen");
	});

	it("turns seen into unseen once the session changes again", () => {
		const seenAt = 2000;
		expect(sessionStatus(summary({ modified: 2000 }), undefined, seenAt)).toBe("seen");
		expect(sessionStatus(summary({ modified: 2001 }), undefined, seenAt)).toBe("unseen");
		// A mark from a later look covers the newer timestamp again.
		expect(sessionStatus(summary({ modified: 2001 }), undefined, 2001)).toBe("seen");
	});

	it("ignores a stale mark from the future and stays quiet", () => {
		expect(sessionStatus(summary({ modified: 2000 }), undefined, 9999)).toBe("seen");
	});

	it("does not let false flags of an open session hide the list entry's own", () => {
		// The list can be a beat ahead of a view that has not received its snapshot yet.
		expect(sessionStatus(summary({ failed: true }), live(), 2000)).toBe("error");
		expect(sessionStatus(summary({ needsInput: true }), live(), 2000)).toBe("needsInput");
		expect(sessionStatus(summary({ isStreaming: true }), live(), 2000)).toBe("working");
	});

	it("treats a running shell command as work in progress", () => {
		const entry = summary();
		expect(sessionStatus(entry, live({ bashRunning: true }), entry.modified)).toBe("working");
	});
});

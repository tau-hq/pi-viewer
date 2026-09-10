import { describe, expect, it } from "vitest";
import { APPROVAL_MODES, approvalModeForKey, nextApprovalMode } from "./approval-modes";

describe("nextApprovalMode", () => {
	it("walks the menu order", () => {
		expect(nextApprovalMode("auto")).toBe("acceptEdits");
		expect(nextApprovalMode("acceptEdits")).toBe("manual");
		expect(nextApprovalMode("manual")).toBe("strict");
	});
	it("wraps around at both ends", () => {
		expect(nextApprovalMode("strict")).toBe("auto");
		expect(nextApprovalMode("auto", -1)).toBe("strict");
	});
	it("falls back to the default without a current mode", () => {
		expect(nextApprovalMode(undefined)).toBe("manual");
	});
	it("returns to the start after a full round", () => {
		expect(nextApprovalMode("manual", APPROVAL_MODES.length)).toBe("manual");
	});
});

describe("approvalModeForKey", () => {
	it("maps 1 to 4 to the four modes", () => {
		expect(["1", "2", "3", "4"].map(approvalModeForKey)).toEqual(["auto", "acceptEdits", "manual", "strict"]);
	});
	it("ignores other keys", () => {
		for (const key of ["0", "5", "9", "a", "Enter", "", "10"]) expect(approvalModeForKey(key)).toBeUndefined();
	});
});

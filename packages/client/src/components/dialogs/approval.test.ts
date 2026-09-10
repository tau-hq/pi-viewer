import { describe, expect, it } from "vitest";
import { approvalShortcuts, parseApproval, shortcutFor, splitTitle } from "./approval";

describe("splitTitle", () => {
	it("keeps single-line titles as heading", () => {
		expect(splitTitle("Pick one")).toEqual({ heading: "Pick one", detail: undefined });
	});
	it("moves the remaining lines into detail", () => {
		expect(splitTitle("Tau approval: bash\necho tau\n")).toEqual({
			heading: "Tau approval: bash",
			detail: "echo tau",
		});
	});
});

describe("parseApproval", () => {
	it("extracts the tool name", () => {
		expect(parseApproval("Tau approval: bash")).toEqual({ toolName: "bash", dangerous: false });
	});
	it("detects dangerous calls", () => {
		expect(parseApproval("Tau approval: bash (dangerous)")).toEqual({ toolName: "bash", dangerous: true });
	});
	it("ignores other requests", () => {
		expect(parseApproval("Choose a branch")).toBeUndefined();
	});
});

describe("approvalShortcuts", () => {
	it("maps A, S and D to the matching options", () => {
		const options = ["Allow once", "Allow bash for this session", "Deny"];
		const shortcuts = approvalShortcuts(options);
		expect(shortcuts).toEqual({ a: "Allow once", s: "Allow bash for this session", d: "Deny" });
		expect(shortcutFor("Deny", shortcuts)).toBe("d");
		expect(shortcutFor("Other", shortcuts)).toBeUndefined();
	});
	it("leaves S unset for dangerous calls", () => {
		expect(approvalShortcuts(["Allow once", "Deny"])).toEqual({ a: "Allow once", d: "Deny" });
	});
});

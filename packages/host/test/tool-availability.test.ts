import { describe, expect, it } from "vitest";
import { runsOnThisHost } from "../src/session/tau-session.js";

const tool = (name: string) => ({ name, active: false });

describe("runsOnThisHost", () => {
	it("keeps powershell on Windows and drops it everywhere else", () => {
		expect(runsOnThisHost(tool("powershell"), "win32")).toBe(true);
		expect(runsOnThisHost(tool("powershell"), "linux")).toBe(false);
		expect(runsOnThisHost(tool("powershell"), "darwin")).toBe(false);
	});

	it("keeps every other tool on every platform", () => {
		for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
			expect(runsOnThisHost(tool(name), "linux")).toBe(true);
			expect(runsOnThisHost(tool(name), "win32")).toBe(true);
		}
	});
});

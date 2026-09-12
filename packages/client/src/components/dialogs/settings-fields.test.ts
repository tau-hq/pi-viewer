import { describe, expect, it } from "vitest";
import { BUILTIN_TOOLS, builtinToolsFor } from "./settings-fields";

describe("builtinToolsFor", () => {
	it("offers powershell only on a Windows host", () => {
		expect(builtinToolsFor("win32")).toEqual(BUILTIN_TOOLS);
		expect(builtinToolsFor("linux")).not.toContain("powershell");
		expect(builtinToolsFor("darwin")).not.toContain("powershell");
	});

	it("offers everything while the host is still unknown", () => {
		expect(builtinToolsFor(undefined)).toEqual(BUILTIN_TOOLS);
	});

	it("drops nothing else", () => {
		expect(builtinToolsFor("linux")).toEqual(BUILTIN_TOOLS.filter((tool) => tool !== "powershell"));
	});
});

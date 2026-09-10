import { describe, expect, it } from "vitest";
import { joinPath, parentPath, pathCrumbs, separatorFor } from "./paths";

describe("paths", () => {
	it("joins without doubling separators", () => {
		expect(joinPath("/srv", "pi-tau", "/")).toBe("/srv/pi-tau");
		expect(joinPath("/", "srv", "/")).toBe("/srv");
	});
	it("finds parents up to the root", () => {
		expect(parentPath("/srv/pi-tau", "/")).toBe("/srv");
		expect(parentPath("/srv", "/")).toBe("/");
		expect(parentPath("/", "/")).toBeUndefined();
		expect(parentPath("C:\\Users\\a", "\\")).toBe("C:\\Users");
		expect(parentPath("C:\\Users", "\\")).toBe("C:\\");
	});
	it("builds crumbs from the root", () => {
		expect(pathCrumbs("/srv/pi-tau", "/")).toEqual([
			{ label: "/", path: "/" },
			{ label: "srv", path: "/srv" },
			{ label: "pi-tau", path: "/srv/pi-tau" },
		]);
		expect(pathCrumbs("C:\\Users", "\\")).toEqual([
			{ label: "C:\\", path: "C:\\" },
			{ label: "Users", path: "C:\\Users" },
		]);
	});
	it("picks the separator by platform", () => {
		expect(separatorFor("linux")).toBe("/");
		expect(separatorFor("win32")).toBe("\\");
	});
});

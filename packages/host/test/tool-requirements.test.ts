import { describe, expect, it } from "vitest";
import { type HostProbe, toolRequirements } from "../src/tool-requirements.js";

function probe(present: string[], options: { root?: boolean; sudo?: boolean } = {}): HostProbe {
	return {
		onPath: async (program) => present.includes(program),
		isRoot: () => options.root === true,
		sudoWorks: async () => options.sudo === true,
	};
}

describe("toolRequirements", () => {
	it("reports a tool as ready when its program is on the PATH", async () => {
		const list = await toolRequirements(probe(["rg", "fd"]));
		expect(list.map((entry) => [entry.tool, entry.available])).toEqual([
			["grep", true],
			["find", true],
		]);
		expect(list.every((entry) => entry.install === undefined && entry.reason === undefined)).toBe(true);
	});

	it("names the program the way a reader knows it", async () => {
		const [grep] = await toolRequirements(probe([]));
		expect(grep?.program).toBe("rg");
		expect(grep?.name).toBe("ripgrep");
	});

	it("accepts Debian's fdfind as fd", async () => {
		const [, find] = await toolRequirements(probe(["fdfind"]));
		expect(find?.available).toBe(true);
	});

	it("offers an install when a package manager is there and root is", async () => {
		const [grep] = await toolRequirements(probe(["apt-get"], { root: true }));
		expect(grep?.available).toBe(false);
		expect(grep?.install).toEqual({ manager: "apt-get", package: "ripgrep" });
	});

	it("takes a manager that needs no root without asking for any", async () => {
		const [grep] = await toolRequirements(probe(["brew"]));
		expect(grep?.install).toEqual({ manager: "brew", package: "ripgrep" });
	});

	it("says why it cannot install when the user may not", async () => {
		const [grep] = await toolRequirements(probe(["apt-get"], { root: false, sudo: false }));
		expect(grep?.install).toBeUndefined();
		expect(grep?.reason).toMatch(/needs root/);
		expect(grep?.reason).toMatch(/sudo apt-get install -y ripgrep/);
	});

	it("says so when the machine has no package manager it can drive", async () => {
		const [grep] = await toolRequirements(probe([]));
		expect(grep?.install).toBeUndefined();
		expect(grep?.reason).toMatch(/No package manager/);
	});
});

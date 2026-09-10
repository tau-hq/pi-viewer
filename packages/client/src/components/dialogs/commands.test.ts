import type { CommandInfo } from "@pi-tau/shared";
import { describe, expect, it } from "vitest";
import { groupCommands } from "./commands";

function command(name: string, source: CommandInfo["source"], scope?: string): CommandInfo {
	return { name, source, ...(scope ? { scope } : {}) };
}

describe("groupCommands", () => {
	it("groups by source in display order and sorts by name", () => {
		const groups = groupCommands([
			command("review", "prompt"),
			command("tau-tools", "extension"),
			command("commit", "prompt"),
			command("pdf", "skill", "project"),
		]);
		expect(groups.map((group) => group.source)).toEqual(["extension", "prompt", "skill"]);
		expect(groups[1]?.commands.map((c) => c.name)).toEqual(["commit", "review"]);
	});

	it("keeps unknown sources visible and drops nameless entries", () => {
		const odd = { name: "weird", source: "mystery" } as unknown as CommandInfo;
		const nameless = { name: "", source: "prompt" } as CommandInfo;
		const groups = groupCommands([odd, nameless]);
		expect(groups).toEqual([{ source: "builtin", commands: [odd] }]);
	});

	it("returns nothing for an empty list", () => {
		expect(groupCommands([])).toEqual([]);
	});
});

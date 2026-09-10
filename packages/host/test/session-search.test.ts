import { describe, expect, it } from "vitest";
import type { PiEntry } from "../src/pi/rpc-types.js";
import { searchEntries } from "../src/session/search.js";

function userEntry(id: string, parentId: string | null, text: string): PiEntry {
	return {
		id,
		parentId,
		timestamp: "2026-09-10T10:00:00.000Z",
		type: "message",
		message: { role: "user", content: text },
	} as PiEntry;
}

function assistantEntry(id: string, parentId: string | null, text: string): PiEntry {
	return {
		id,
		parentId,
		timestamp: "2026-09-10T10:01:00.000Z",
		type: "message",
		message: {
			role: "assistant",
			content: [{ type: "text", text }],
			provider: "nebius",
			model: "glm",
			usage: {},
			stopReason: "stop",
		},
	} as PiEntry;
}

describe("searchEntries", () => {
	const entries: PiEntry[] = [
		userEntry("a", null, "Please open the deployment file"),
		assistantEntry("b", "a", "The deployment lives in deploy/tau-host.service"),
		// A branch the user left: still in the file, never on screen.
		assistantEntry("c", "a", "An abandoned answer about deployment"),
		userEntry("d", "b", "thanks"),
	];

	it("finds hits case-insensitively and says which branch they are on", () => {
		const { matches, truncated } = searchEntries(entries, "d", "DEPLOYMENT");
		expect(truncated).toBe(false);
		expect(matches.map((match) => match.entryId)).toEqual(["a", "b", "c"]);
		expect(matches.filter((match) => match.onActivePath).map((match) => match.entryId)).toEqual(["a", "b"]);
	});

	it("marks the hit inside the preview", () => {
		const [match] = searchEntries(entries, "d", "deploy/tau-host").matches;
		expect(match).toBeDefined();
		if (!match) return;
		expect(match.preview.slice(match.offset, match.offset + match.length)).toBe("deploy/tau-host");
		expect(match.role).toBe("assistant");
	});

	it("reports at most one hit per entry and stops at the limit", () => {
		const { matches, truncated } = searchEntries(entries, "d", "deployment", 2);
		expect(matches).toHaveLength(2);
		expect(truncated).toBe(true);
	});

	it("cuts a long line on word boundaries and says so with an ellipsis", () => {
		const long: PiEntry = userEntry(
			"f",
			null,
			`${"filler word ".repeat(20)}the needle sits here${" trailing word".repeat(30)}`,
		);
		const [match] = searchEntries([long], "f", "needle").matches;
		expect(match).toBeDefined();
		if (!match) return;
		expect(match.preview.startsWith("\u2026")).toBe(true);
		expect(match.preview.endsWith("\u2026")).toBe(true);
		// No half word at either cut, and the marked range is still the hit itself.
		expect(match.preview.slice(1, 2)).not.toBe(" ");
		expect(match.preview.slice(match.offset, match.offset + match.length)).toBe("needle");
	});

	it("returns nothing for an empty query", () => {
		expect(searchEntries(entries, "d", "   ").matches).toEqual([]);
	});

	it("searches a shell command and its output", () => {
		const bash: PiEntry = {
			id: "e",
			parentId: "d",
			timestamp: "2026-09-10T10:02:00.000Z",
			type: "message",
			message: { role: "bashExecution", command: "systemctl status tau-host", output: "active (running)" },
		} as PiEntry;
		const { matches } = searchEntries([...entries, bash], "e", "active (running)");
		expect(matches.map((match) => match.entryId)).toEqual(["e"]);
		expect(matches[0]?.role).toBe("bashExecution");
	});
});

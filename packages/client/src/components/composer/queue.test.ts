import { describe, expect, it } from "vitest";
import { parseClearedQueue, queueEntries, requeueCommands } from "./queue";

const cleared = { steering: ["s1", "s2"], followUp: ["f1"] };

describe("queueEntries", () => {
	it("lists steering entries before follow-ups and keeps their own indexes", () => {
		const entries = queueEntries(cleared.steering, cleared.followUp);
		expect(entries.map((entry) => `${entry.kind}:${entry.index}:${entry.text}`)).toEqual([
			"steering:0:s1",
			"steering:1:s2",
			"followUp:0:f1",
		]);
	});
});

describe("parseClearedQueue", () => {
	it("reads both lists and ignores anything that is not a string", () => {
		expect(parseClearedQueue({ steering: ["a", 1], followUp: "no" })).toEqual({ steering: ["a"], followUp: [] });
		expect(parseClearedQueue(null)).toEqual({ steering: [], followUp: [] });
	});
});

describe("requeueCommands", () => {
	const entries = queueEntries(cleared.steering, cleared.followUp);

	it("re-sends every other entry in order, steering as steer and follow-ups as followUp", () => {
		const commands = requeueCommands(cleared, entries[1] as (typeof entries)[number]);
		expect(commands).toEqual([
			{ type: "steer", message: "s1" },
			{ type: "followUp", message: "f1" },
		]);
	});

	it("removes only from the list the entry belongs to", () => {
		const commands = requeueCommands(cleared, entries[2] as (typeof entries)[number]);
		expect(commands).toEqual([
			{ type: "steer", message: "s1" },
			{ type: "steer", message: "s2" },
		]);
	});

	it("falls back to the text when the queue shifted below the shown index", () => {
		const shifted = { steering: ["s2"], followUp: ["f1"] };
		const commands = requeueCommands(shifted, entries[1] as (typeof entries)[number]);
		expect(commands).toEqual([{ type: "followUp", message: "f1" }]);
	});

	it("restores everything when the removed entry is gone already", () => {
		const other = { steering: ["x"], followUp: [] };
		const commands = requeueCommands(other, entries[1] as (typeof entries)[number]);
		expect(commands).toEqual([{ type: "steer", message: "x" }]);
	});

	it("keeps duplicates apart by index", () => {
		const twins = { steering: ["same", "same"], followUp: [] };
		const list = queueEntries(twins.steering, twins.followUp);
		expect(requeueCommands(twins, list[0] as (typeof list)[number])).toEqual([{ type: "steer", message: "same" }]);
	});
});

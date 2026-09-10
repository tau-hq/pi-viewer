import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PiEntry, PiMessage } from "../src/pi/rpc-types.js";
import { entriesToTranscript, toMessage, toSessionState, toUsage } from "../src/session/translate.js";

const here = dirname(fileURLToPath(import.meta.url));
const sample = readFileSync(join(here, "..", "..", "..", "docs", "research", "rpc-sample-0.85.1.jsonl"), "utf8")
	.split("\n")
	.filter((l) => l.trim().length > 0)
	.map((l) => JSON.parse(l) as Record<string, unknown>);

function response(command: string): Record<string, unknown> {
	const r = sample.find((e) => e.type === "response" && e.command === command);
	if (!r) throw new Error(`no ${command} response in sample`);
	return r.data as Record<string, unknown>;
}

describe("translate (against the recorded pi 0.85.1 sample)", () => {
	it("rebuilds the active branch from get_entries", () => {
		const data = response("get_entries") as { entries: PiEntry[]; leafId: string };
		const messages = entriesToTranscript(data.entries, data.leafId);
		expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "toolResult", "assistant"]);
		const tool = messages.find((m) => m.role === "toolResult");
		expect(tool && tool.role === "toolResult" ? tool.toolName : undefined).toBe("read");
		// ids are pi's durable entry ids, not live ids
		for (const m of messages) expect(m.id).not.toMatch(/^live-/);
		const last = messages[messages.length - 1];
		expect(last?.id).toBe(data.leafId);
	});

	it("keeps abandoned branches out of the transcript", () => {
		const entries: PiEntry[] = [
			{
				type: "message",
				id: "a",
				parentId: null,
				timestamp: "2026-01-01T00:00:00Z",
				message: { role: "user", content: "root", timestamp: 1 },
			},
			{
				type: "message",
				id: "b",
				parentId: "a",
				timestamp: "2026-01-01T00:00:01Z",
				message: { role: "user", content: "branch 1", timestamp: 2 },
			},
			{
				type: "message",
				id: "c",
				parentId: "a",
				timestamp: "2026-01-01T00:00:02Z",
				message: { role: "user", content: "branch 2", timestamp: 3 },
			},
		];
		const messages = entriesToTranscript(entries, "c");
		expect(messages.map((m) => m.id)).toEqual(["a", "c"]);
	});

	it("converts assistant messages with usage and stop reasons", () => {
		const end = sample.find(
			(e) =>
				e.type === "message_end" &&
				(e.message as PiMessage).role === "assistant" &&
				(e.message as { stopReason: string }).stopReason === "toolUse",
		);
		if (!end) throw new Error("no toolUse assistant message in sample");
		const m = toMessage("x", end.message as PiMessage);
		expect(m?.role).toBe("assistant");
		if (m?.role !== "assistant") return;
		expect(m.stopReason).toBe("toolUse");
		expect(m.content.map((c) => c.type)).toEqual(["thinking", "toolCall"]);
		expect(m.usage.totalTokens).toBeGreaterThan(0);
		expect(m.usage.reasoning).toBeGreaterThan(0);
	});

	it("maps state and usage defensively", () => {
		const state = toSessionState(response("get_state") as never, "/tmp/x", true);
		expect(state.model?.provider).toBe("nebius");
		expect(state.thinkingLevel).toBeDefined();
		expect(toUsage(undefined).totalTokens).toBe(0);
	});
});

describe("toTree", () => {
	const entry = (id: string, parentId: string | null, extra: Record<string, unknown> = {}): PiEntry =>
		({
			type: "message",
			id,
			parentId,
			timestamp: "2026-01-01T00:00:00Z",
			message: { role: "user", content: id, timestamp: 1 },
			...extra,
		}) as PiEntry;
	it("marks the active path from the tree itself and drops Tau bookkeeping entries", async () => {
		const { toTree } = await import("../src/session/translate.js");
		const bookkeeping: PiEntry = {
			type: "custom",
			id: "t",
			parentId: "a",
			timestamp: "2026-01-01T00:00:01Z",
			customType: "tau.tools",
			data: {},
		} as PiEntry;
		const tree = [
			{
				entry: entry("a", null),
				children: [
					{ entry: bookkeeping, children: [{ entry: entry("b", "t"), children: [] }] },
					{ entry: entry("c", "a"), children: [] },
				],
			},
		];
		const out = toTree(tree, "b");
		expect(out).toHaveLength(1);
		const root = out[0];
		if (!root) throw new Error("no root");
		expect(root.onActivePath).toBe(true);
		expect(root.children.map((c) => c.id)).toEqual(["b", "c"]);
		expect(root.children.find((c) => c.id === "b")?.parentId).toBe("a");
		expect(root.children.find((c) => c.id === "b")?.onActivePath).toBe(true);
		expect(root.children.find((c) => c.id === "c")?.onActivePath).toBe(false);
	});
});

import { describe, expect, it } from "vitest";
import type { PiEntry, PiTreeNode } from "../src/pi/rpc-types.js";
import { toTree } from "../src/session/translate.js";

const at = "2026-09-12T10:00:00.000Z";

function chain(entries: PiEntry[]): PiTreeNode[] {
	// One linear branch: every entry is the only child of the one before it.
	let child: PiTreeNode | undefined;
	for (const entry of [...entries].reverse()) child = { entry, children: child ? [child] : [] };
	return child ? [child] : [];
}

const user = (id: string, parentId: string | null): PiEntry =>
	({ id, parentId, timestamp: at, type: "message", message: { role: "user", content: "question" } }) as PiEntry;

const assistant = (id: string, parentId: string, calls: string[], stopReason = "stop"): PiEntry =>
	({
		id,
		parentId,
		timestamp: at,
		type: "message",
		message: {
			role: "assistant",
			content: calls.length
				? calls.map((call) => ({ type: "toolCall", id: call, name: "ls", arguments: {} }))
				: [{ type: "text", text: "answer" }],
			provider: "nebius",
			model: "glm",
			usage: {},
			stopReason,
		},
	}) as PiEntry;

const result = (id: string, parentId: string, call: string): PiEntry =>
	({
		id,
		parentId,
		timestamp: at,
		type: "message",
		message: { role: "toolResult", toolCallId: call, toolName: "ls", content: [], isError: false },
	}) as PiEntry;

function flags(nodes: ReturnType<typeof toTree>): Record<string, boolean | undefined> {
	const out: Record<string, boolean | undefined> = {};
	const walk = (list: ReturnType<typeof toTree>) => {
		for (const node of list) {
			out[node.id] = node.cleanCut;
			walk(node.children);
		}
	};
	walk(nodes);
	return out;
}

describe("toTree cleanCut", () => {
	it("marks a tool call unclean until every one of its results has arrived", () => {
		const tree = chain([
			user("ask", null),
			assistant("calls", "ask", ["one", "two"]),
			result("first", "calls", "one"),
			result("second", "first", "two"),
			assistant("answer", "second", []),
		]);
		expect(flags(toTree(tree, "answer"))).toEqual({
			ask: true,
			calls: false,
			first: false,
			second: true,
			answer: true,
		});
	});

	it("never counts an answer that broke off as a place where the conversation stood whole", () => {
		const tree = chain([user("ask", null), assistant("broken", "ask", ["one"], "aborted")]);
		// pi drops the aborted answer from the context, so its call never opens - but the answer
		// itself is still no clean place to stand.
		expect(flags(toTree(tree, "broken"))).toEqual({ ask: true, broken: false });
	});

	it("keeps the open calls of one branch out of its sibling", () => {
		const ask = user("ask", null);
		const calls = assistant("calls", "ask", ["one"]);
		const answered = result("answered", "calls", "one");
		const text = assistant("text", "ask", []);
		const tree: PiTreeNode[] = [
			{
				entry: ask,
				children: [
					{ entry: calls, children: [{ entry: answered, children: [] }] },
					{ entry: text, children: [] },
				],
			},
		];
		expect(flags(toTree(tree, "text"))).toEqual({ ask: true, calls: false, answered: true, text: true });
	});
});

import type { TreeNode } from "@pi-tau/shared";
import { describe, expect, it } from "vitest";
import {
	countNodes,
	filterTree,
	flattenTree,
	initialCollapsed,
	jumpTarget,
	landingForHit,
	markActivePath,
	typeLabel,
} from "./tree";

function node(id: string, onActivePath: boolean, children: TreeNode[] = []): TreeNode {
	return {
		id,
		parentId: null,
		type: "message",
		preview: id,
		timestamp: "2026-09-10T00:00:00Z",
		children,
		onActivePath,
	};
}

// a -> b -> (c -> d [active], e -> f)
const tree = [
	node("a", true, [node("b", true, [node("c", true, [node("d", true)]), node("e", false, [node("f", false)])])]),
];

describe("flattenTree", () => {
	it("keeps linear chains flat and indents below branch points", () => {
		const rows = flattenTree(tree, new Set());
		expect(rows.map((row) => `${row.node.id}:${row.depth}`)).toEqual(["a:0", "b:0", "c:1", "d:1", "e:1", "f:1"]);
		expect(rows.find((row) => row.node.id === "b")?.collapsible).toBe(true);
		expect(rows.find((row) => row.node.id === "a")?.collapsible).toBe(false);
	});
	it("hides collapsed subtrees", () => {
		const rows = flattenTree(tree, new Set(["e"]));
		expect(rows.map((row) => row.node.id)).toEqual(["a", "b", "c", "d", "e"]);
	});
});

describe("markActivePath", () => {
	it("derives the path from the leaf when the host left the flags unset", () => {
		const f = { ...node("f", false), parentId: "e" };
		const e = { ...node("e", false, [f]), parentId: "b" };
		const b = { ...node("b", false, [e]), parentId: "a" };
		const a = node("a", false, [b]);
		const marked = markActivePath([a], "e");
		const ids = (nodes: TreeNode[], out: string[] = []): string[] => {
			for (const n of nodes) {
				if (n.onActivePath) out.push(n.id);
				ids(n.children, out);
			}
			return out;
		};
		expect(ids(marked)).toEqual(["a", "b", "e"]);
	});
	it("keeps host flags when present", () => {
		expect(markActivePath(tree, "zzz")).toEqual(tree);
	});
});

describe("typeLabel", () => {
	it("prefers the role and shortens entry types", () => {
		expect(typeLabel({ ...node("x", true), role: "assistant" })).toBe("assistant");
		expect(typeLabel({ ...node("x", true), type: "thinking_level_change" })).toBe("thinking level");
	});
});

describe("initialCollapsed", () => {
	it("collapses side branches with children only", () => {
		expect([...initialCollapsed(tree)]).toEqual(["e"]);
	});
});

describe("filterTree", () => {
	// user -> assistant -> toolResult -> assistant(labeled), plus a model_change entry.
	const message = (id: string, role: TreeNode["role"], extra: Partial<TreeNode> = {}): TreeNode => ({
		...node(id, true),
		type: "message",
		...(role ? { role } : {}),
		...extra,
	});
	const labeled = message("d", "assistant", { label: "checkpoint" });
	const chain = [
		message("a", "user", {
			children: [
				{
					...node("m", true),
					type: "model_change",
					children: [message("b", "assistant", { children: [message("c", "toolResult", { children: [labeled] })] })],
				},
			],
		}),
	];

	it("keeps everything with the all filter", () => {
		expect(countNodes(filterTree(chain, "all"))).toBe(5);
	});
	it("drops tool results and settings entries but keeps their children", () => {
		const rows = flattenTree(filterTree(chain, "no-tools"), new Set());
		expect(rows.map((row) => row.node.id)).toEqual(["a", "b", "d"]);
	});
	it("keeps only user messages", () => {
		const rows = flattenTree(filterTree(chain, "user-only"), new Set());
		expect(rows.map((row) => row.node.id)).toEqual(["a"]);
	});
	it("keeps only labeled entries", () => {
		const rows = flattenTree(filterTree(chain, "labeled-only"), new Set());
		expect(rows.map((row) => row.node.id)).toEqual(["d"]);
	});
});

function entry(
	id: string,
	type: string,
	role: TreeNode["role"],
	children: TreeNode[] = [],
	cleanCut?: boolean,
): TreeNode {
	return {
		id,
		parentId: null,
		type,
		preview: id,
		timestamp: "2026-09-10T00:00:00Z",
		children,
		onActivePath: false,
		...(role ? { role } : {}),
		...(cleanCut === undefined ? {} : { cleanCut }),
	};
}

describe("jumpTarget", () => {
	it("offers the place just before every user message", () => {
		const answer = entry("answer", "message", "assistant");
		expect(jumpTarget(entry("ask", "message", "user", [answer]))).toEqual({ entryId: "ask", kind: "beforeMessage" });
		// Also a message nobody answered: standing before it is the state it came from.
		expect(jumpTarget(entry("unanswered", "message", "user"))).toEqual({
			entryId: "unanswered",
			kind: "beforeMessage",
		});
	});

	it("offers the end of every branch", () => {
		expect(jumpTarget(entry("tip", "message", "assistant"))).toEqual({ entryId: "tip", kind: "branchEnd" });
		expect(jumpTarget(entry("setting", "thinking_level_change", undefined))).toEqual({
			entryId: "setting",
			kind: "branchEnd",
		});
	});

	it("offers a point inside an answer only where nothing is half done", () => {
		const more = entry("more", "message", "assistant");
		// The host marks the call as unclean (its result is still to come) and the result as clean.
		const result = entry("result", "message", "toolResult", [more], true);
		const call = entry("call", "message", "assistant", [result], false);
		expect(jumpTarget(call)).toBeUndefined();
		expect(jumpTarget(result)).toEqual({ entryId: "result", kind: "cleanPoint" });
		const text = entry("text", "message", "assistant", [entry("next", "message", "user")], true);
		expect(jumpTarget(text)).toEqual({ entryId: "text", kind: "cleanPoint" });
	});

	it("does not offer bookkeeping entries as clean points", () => {
		const setting = entry("setting", "thinking_level_change", undefined, [entry("x", "message", "user")], true);
		expect(jumpTarget(setting)).toBeUndefined();
	});

	it("offers nothing where the host did not say it is clean", () => {
		const unknown = entry("unknown", "message", "assistant", [entry("x", "message", "user")]);
		expect(jumpTarget(unknown)).toBeUndefined();
	});

	it("never offers a custom message, which pi takes back like a user message", () => {
		expect(jumpTarget(entry("custom", "custom_message", undefined))).toBeUndefined();
	});
});

describe("landingForHit", () => {
	// u1 -> call -> result -> answer1 -> u2 -> answer2
	const answer2 = entry("answer2", "message", "assistant");
	const u2 = entry("u2", "message", "user", [answer2]);
	const answer1 = entry("answer1", "message", "assistant", [u2]);
	const result = entry("result", "message", "toolResult", [answer1]);
	const call = entry("call", "message", "assistant", [result]);
	const tree = [entry("u1", "message", "user", [call])];

	it("lands at the end of the answer a hit sits in, not in its middle", () => {
		expect(landingForHit(tree, "call")).toBe("answer1");
		expect(landingForHit(tree, "result")).toBe("answer1");
	});

	it("shows a user message together with its answer", () => {
		expect(landingForHit(tree, "u1")).toBe("answer1");
	});

	it("lands at the end of the branch when no user message follows", () => {
		expect(landingForHit(tree, "u2")).toBe("answer2");
		expect(landingForHit(tree, "answer2")).toBe("answer2");
	});

	it("knows nothing about an entry that is not in the tree", () => {
		expect(landingForHit(tree, "missing")).toBeUndefined();
	});
});

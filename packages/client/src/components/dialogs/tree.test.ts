import type { TreeNode } from "@pi-tau/shared";
import { describe, expect, it } from "vitest";
import { countNodes, filterTree, flattenTree, initialCollapsed, markActivePath, typeLabel } from "./tree";

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

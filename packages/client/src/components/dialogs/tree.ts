import type { TreeNode } from "@pi-tau/shared";

export interface TreeRow {
	node: TreeNode;
	/** Indentation level; only increases below branch points so linear chains stay flat. */
	depth: number;
	/** True when the row can hide its descendants (branch points and heads of side branches). */
	collapsible: boolean;
}

/** Depth-first rows of the tree with collapsed subtrees left out. */
export function flattenTree(
	nodes: readonly TreeNode[],
	collapsed: ReadonlySet<string>,
	depth = 0,
	branchHead = nodes.length > 1,
	out: TreeRow[] = [],
): TreeRow[] {
	for (const node of nodes) {
		const branch = node.children.length > 1;
		out.push({ node, depth, collapsible: node.children.length > 0 && (branch || branchHead) });
		if (collapsed.has(node.id)) continue;
		flattenTree(node.children, collapsed, branch ? depth + 1 : depth, branch, out);
	}
	return out;
}

/**
 * Hosts may leave `onActivePath` unset; derive it from the leaf by walking parent ids so the
 * highlight never depends on that flag alone.
 */
export function markActivePath(nodes: readonly TreeNode[], leafId: string | undefined): TreeNode[] {
	if (!leafId || nodes.some((node) => node.onActivePath) || collect(nodes).some((node) => node.onActivePath)) {
		return [...nodes];
	}
	const byId = new Map(collect(nodes).map((node) => [node.id, node] as const));
	const active = new Set<string>();
	let cursor = byId.get(leafId);
	while (cursor) {
		active.add(cursor.id);
		cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
	}
	const mark = (node: TreeNode): TreeNode => ({
		...node,
		onActivePath: active.has(node.id),
		children: node.children.map(mark),
	});
	return nodes.map(mark);
}

function collect(nodes: readonly TreeNode[], out: TreeNode[] = []): TreeNode[] {
	for (const node of nodes) {
		out.push(node);
		collect(node.children, out);
	}
	return out;
}

/** The filters pi's own `/tree` offers, using pi's names. */
export type TreeFilter = "all" | "no-tools" | "user-only" | "labeled-only";

export const TREE_FILTERS: readonly TreeFilter[] = ["all", "no-tools", "user-only", "labeled-only"];

/** Settings and bookkeeping entries, which pi hides in every view but "all". */
const SETTINGS_TYPES: ReadonlySet<string> = new Set([
	"label",
	"custom",
	"model_change",
	"thinking_level_change",
	"session_info",
]);

function passes(node: TreeNode, filter: TreeFilter): boolean {
	switch (filter) {
		case "user-only":
			return node.role === "user";
		case "no-tools":
			return !SETTINGS_TYPES.has(node.type) && node.role !== "toolResult";
		case "labeled-only":
			return node.label !== undefined && node.label.length > 0;
		case "all":
			return true;
	}
}

/**
 * Drop the nodes a filter hides. Children of a hidden node move up to its nearest visible
 * ancestor, so a branch never disappears because one of its entries is filtered out.
 */
export function filterTree(nodes: readonly TreeNode[], filter: TreeFilter): TreeNode[] {
	if (filter === "all") return [...nodes];
	const out: TreeNode[] = [];
	for (const node of nodes) {
		const children = filterTree(node.children, filter);
		if (passes(node, filter)) out.push({ ...node, children });
		else out.push(...children);
	}
	return out;
}

export function countNodes(nodes: readonly TreeNode[]): number {
	return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);
}

/** Short column label: the message role, or pi's entry type without its `_change` suffix. */
export function typeLabel(node: TreeNode): string {
	if (node.role) return node.role;
	return node.type.replace(/_change$/, "").replace(/_/g, " ");
}

/** Side branches (not on the active path) start collapsed so the current conversation stays readable. */
export function initialCollapsed(nodes: readonly TreeNode[], out = new Set<string>()): Set<string> {
	for (const node of nodes) {
		const branch = node.children.length > 1;
		for (const child of node.children) {
			if (branch && !child.onActivePath && child.children.length > 0) out.add(child.id);
		}
		initialCollapsed(node.children, out);
	}
	return out;
}

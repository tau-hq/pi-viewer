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

function isUserMessage(node: TreeNode): boolean {
	return node.type === "message" && node.role === "user";
}

/**
 * Where a click on a row may take the conversation. Only two kinds of place are offered, and
 * both are places a conversation really was:
 *
 * - just before a user message: the answer before it is complete, and the message goes back
 *   into the composer, exactly what the fork dialog offers;
 * - the end of a branch: the conversation as it was left there.
 *
 * Everything else would cut an answer in two - an assistant message kept without the tool
 * results it asked for, which pi then fills with "No result provided" errors - so those rows
 * are shown for orientation and cannot be picked.
 */
export type JumpTarget = { entryId: string; kind: "beforeMessage" | "branchEnd" };

export function jumpTarget(node: TreeNode): JumpTarget | undefined {
	if (isUserMessage(node)) return { entryId: node.id, kind: "beforeMessage" };
	// pi takes a custom message back just like a user message, so its end is no place to stand.
	if (node.children.length === 0 && node.type !== "custom_message") return { entryId: node.id, kind: "branchEnd" };
	return undefined;
}

/**
 * Where a search hit on another branch is shown without cutting an answer: at the end of the
 * answer it sits in, which is the entry right before the next user message on its branch, or
 * at the end of the branch when no user message follows. Landing on that entry rather than on
 * the user message keeps pi from putting an unrelated message into the composer.
 */
export function landingForHit(tree: readonly TreeNode[], entryId: string): string | undefined {
	let cursor = collect(tree).find((node) => node.id === entryId);
	if (!cursor) return undefined;
	for (let next = cursor.children[0]; next; next = cursor.children[0]) {
		if (isUserMessage(next)) return cursor.id;
		cursor = next;
	}
	return cursor.id;
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

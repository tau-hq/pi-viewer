import type { MessageRole, SearchMatch } from "@pi-tau/shared";
import type { PiEntry, PiImageContent, PiMessage, PiTextContent } from "../pi/rpc-types.js";

const PREVIEW_BEFORE = 40;
const PREVIEW_AFTER = 120;

function textOf(content: string | (PiTextContent | PiImageContent)[] | undefined): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => (part.type === "text" ? part.text : ""))
		.filter(Boolean)
		.join("\n");
}

/** Everything in a message a reader could search for, plus the role to show with a hit. */
function searchable(message: PiMessage): { role: MessageRole | "other"; text: string } {
	switch (message.role) {
		case "user":
			return { role: "user", text: textOf(message.content) };
		case "assistant": {
			const parts: string[] = [];
			for (const block of message.content ?? []) {
				if (block.type === "text") parts.push(block.text);
				else if (block.type === "thinking") parts.push(block.thinking);
				else if (block.type === "toolCall") parts.push(`${block.name} ${JSON.stringify(block.arguments)}`);
			}
			return { role: "assistant", text: parts.join("\n") };
		}
		case "toolResult":
			return { role: "toolResult", text: `${message.toolName}\n${textOf(message.content)}` };
		case "bashExecution":
			return { role: "bashExecution", text: `${message.command}\n${message.output}` };
		case "custom":
			return { role: "custom", text: textOf(message.content) };
		case "branchSummary":
			return { role: "branchSummary", text: message.summary };
		case "compactionSummary":
			return { role: "compactionSummary", text: message.summary };
		default:
			return { role: "other", text: "" };
	}
}

function entryText(entry: PiEntry): { role: MessageRole | "other"; text: string } {
	if (entry.type === "message") return searchable(entry.message);
	if (entry.type === "compaction") return { role: "compactionSummary", text: entry.summary };
	if (entry.type === "branch_summary") return { role: "branchSummary", text: entry.summary };
	if (entry.type === "custom_message") return { role: "custom", text: textOf(entry.content) };
	return { role: "other", text: "" };
}

/** Ids from the leaf up to the root: the branch the transcript currently shows. */
function activePath(entries: PiEntry[], leafId: string | null | undefined): Set<string> {
	const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
	const ids = new Set<string>();
	let cursor = leafId ? byId.get(leafId) : undefined;
	while (cursor && !ids.has(cursor.id)) {
		ids.add(cursor.id);
		cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
	}
	return ids;
}

/**
 * Find `query` in every entry of a session. Unlike the browser's own find, this covers
 * what the transcript does not show: abandoned branches and history a compaction replaced.
 */
export function searchEntries(
	entries: PiEntry[],
	leafId: string | null | undefined,
	query: string,
	limit = 100,
): { matches: SearchMatch[]; truncated: boolean } {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) return { matches: [], truncated: false };
	const active = activePath(entries, leafId);
	const matches: SearchMatch[] = [];

	for (const entry of entries) {
		const { role, text } = entryText(entry);
		if (text.length === 0) continue;
		const haystack = text.toLowerCase();
		let from = 0;
		// At most one hit per entry: the list is for jumping to a message, not for counting.
		const at = haystack.indexOf(needle, from);
		if (at === -1) continue;
		from = at;
		const lineStart = text.lastIndexOf("\n", at) + 1;
		const start = Math.max(lineStart, at - PREVIEW_BEFORE);
		const lineEnd = text.indexOf("\n", at);
		const end = Math.min(lineEnd === -1 ? text.length : lineEnd, at + needle.length + PREVIEW_AFTER);
		const preview = text.slice(start, end).trim();
		matches.push({
			entryId: entry.id,
			role,
			preview,
			offset: at - start - (text.slice(start, end).length - text.slice(start, end).trimStart().length),
			length: needle.length,
			onActivePath: active.has(entry.id),
			timestamp: entry.timestamp,
		});
		if (matches.length >= limit) return { matches, truncated: true };
	}
	return { matches, truncated: false };
}

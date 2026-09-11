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
 * The hit inside its line, cut to a readable length. Cuts land on word boundaries and are
 * marked with an ellipsis, so a preview never starts in the middle of a word.
 */
function previewAround(text: string, at: number, length: number): { preview: string; offset: number } {
	const lineStart = text.lastIndexOf("\n", at) + 1;
	const lineEnd = text.indexOf("\n", at);
	const hardEnd = lineEnd === -1 ? text.length : lineEnd;
	let start = Math.max(lineStart, at - PREVIEW_BEFORE);
	let end = Math.min(hardEnd, at + length + PREVIEW_AFTER);
	if (start > lineStart) {
		const space = text.indexOf(" ", start);
		if (space !== -1 && space < at) start = space + 1;
	}
	if (end < hardEnd) {
		const space = text.lastIndexOf(" ", end);
		if (space > at + length) end = space;
	}
	const slice = text.slice(start, end);
	const lead = slice.length - slice.trimStart().length;
	const head = start > lineStart ? "\u2026" : "";
	const tail = end < hardEnd ? "\u2026" : "";
	return { preview: `${head}${slice.trim()}${tail}`, offset: at - start - lead + head.length };
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
		// Every occurrence, not one per entry: the counter beside the search field names words.
		let index = 0;
		for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
			const { preview, offset } = previewAround(text, at, needle.length);
			matches.push({
				entryId: entry.id,
				index: index++,
				role,
				preview,
				offset,
				length: needle.length,
				onActivePath: active.has(entry.id),
				timestamp: entry.timestamp,
			});
			if (matches.length >= limit) return { matches, truncated: true };
		}
	}
	return { matches, truncated: false };
}

import type { FileMatch } from "@pi-tau/shared";

/** The `@…` token the caret sits in: what to search for, and what an accepted path replaces. */
export interface MentionContext {
	/** Index of the `@`. */
	start: number;
	/** Index just past the token; a replacement covers [start, end). */
	end: number;
	/** Text between `@` and `end`, which is the search query. */
	query: string;
}

function isBoundary(char: string | undefined): boolean {
	return char === undefined || /\s/.test(char);
}

/**
 * The mention being typed at `caret`, if any. A mention starts at an `@` that follows whitespace
 * (or the very beginning of the text) and runs to the next whitespace, so an email address or a
 * `user@host` argument never opens the popup.
 */
export function findMention(text: string, caret: number): MentionContext | undefined {
	const position = Math.max(0, Math.min(caret, text.length));
	let start = -1;
	for (let index = position - 1; index >= 0; index--) {
		const char = text[index];
		if (char === "@") {
			start = index;
			break;
		}
		if (isBoundary(char)) return undefined;
	}
	// `start === 0` means the text begins with the mention, which is allowed.
	if (start < 0 || (start > 0 && !isBoundary(text[start - 1]))) return undefined;
	let end = position;
	while (end < text.length && !isBoundary(text[end])) end++;
	return { start, end, query: text.slice(start + 1, end) };
}

export interface MentionInsertion {
	text: string;
	caret: number;
	/** True for a directory: the popup stays open so the user can drill down. */
	keepOpen: boolean;
}

/**
 * Replace the mention token with the accepted path. A file ends the mention with a trailing space,
 * a directory keeps the caret inside the token so the next search lists its content. A space that
 * already followed the token is swallowed, so completing inside a sentence leaves no double space.
 */
export function applyMention(text: string, mention: MentionContext, file: FileMatch): MentionInsertion {
	const path = file.isDirectory && !file.path.endsWith("/") ? `${file.path}/` : file.path;
	const inserted = file.isDirectory ? `@${path}` : `@${path} `;
	const rest = text.slice(mention.end);
	const tail = !file.isDirectory && rest.startsWith(" ") ? rest.slice(1) : rest;
	return {
		text: text.slice(0, mention.start) + inserted + tail,
		caret: mention.start + inserted.length,
		keepOpen: file.isDirectory,
	};
}

export interface MentionLabel {
	/** Directory in front of the entry, with a trailing separator; empty at the root. */
	dir: string;
	/** The entry's own name; directories keep their trailing slash. */
	name: string;
}

/** Split a match for the popup: the name is shown, the directory only hinted at. */
export function mentionLabel(path: string): MentionLabel {
	const isDirectory = path.endsWith("/");
	const trimmed = isDirectory ? path.slice(0, -1) : path;
	const cut = trimmed.lastIndexOf("/");
	return {
		dir: cut < 0 ? "" : trimmed.slice(0, cut + 1),
		name: `${trimmed.slice(cut + 1)}${isDirectory ? "/" : ""}`,
	};
}

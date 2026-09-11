/**
 * Marking found words without touching the DOM. The transcript is rendered markdown, shiki
 * output and tool cards; wrapping matches in elements would mean rewriting all of it and would
 * fight the virtual list. The browser's highlight registry paints ranges instead, so the text
 * stays exactly as it was rendered.
 */

const NAME = "tau-search";

interface HighlightRegistry {
	set: (name: string, highlight: object) => void;
	delete: (name: string) => void;
}

interface HighlightGlobals {
	CSS?: { highlights?: HighlightRegistry };
	Highlight?: new (...ranges: Range[]) => object;
}

function globals(): HighlightGlobals {
	return globalThis as HighlightGlobals;
}

/** False on a browser without the highlight registry; the search then simply does not paint. */
export function highlightsSupported(): boolean {
	const scope = globals();
	return scope.CSS?.highlights !== undefined && typeof scope.Highlight === "function";
}

/**
 * Every occurrence of `needle` inside `root`, case-insensitively, as ranges. A match that runs
 * across two elements is not found: the text of one element is one node, and that is what the
 * eye reads as a word anyway.
 */
export function collectMatchRanges(root: Node, needle: string, limit = 4000): Range[] {
	const lower = needle.toLowerCase();
	if (lower.length === 0) return [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const ranges: Range[] = [];
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		const text = node.nodeValue ?? "";
		if (text.length < lower.length) continue;
		const haystack = text.toLowerCase();
		for (let at = haystack.indexOf(lower); at !== -1; at = haystack.indexOf(lower, at + lower.length)) {
			const range = document.createRange();
			range.setStart(node, at);
			range.setEnd(node, at + lower.length);
			ranges.push(range);
			if (ranges.length >= limit) return ranges;
		}
	}
	return ranges;
}

export function paintHighlight(ranges: Range[]): void {
	const scope = globals();
	const registry = scope.CSS?.highlights;
	const Ctor = scope.Highlight;
	if (!registry || typeof Ctor !== "function") return;
	if (ranges.length === 0) {
		registry.delete(NAME);
		return;
	}
	registry.set(NAME, new Ctor(...ranges));
}

export function clearHighlight(): void {
	globals().CSS?.highlights?.delete(NAME);
}

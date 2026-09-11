import { type RefObject, useEffect } from "react";
import { clearHighlight, collectMatchRanges, highlightsSupported, paintHighlight } from "@/lib/text-highlight";

/** Below this a search marks nothing: two letters would light up half the transcript. */
export const MIN_HIGHLIGHT_LENGTH = 3;

/** pi's entry ids are plain, but a selector built from data never goes in unescaped. */
function cssEscape(value: string): string {
	const escape = (globalThis as { CSS?: { escape?: (input: string) => string } }).CSS?.escape;
	return escape ? escape(value) : value.replace(/["\\]/g, "\\$&");
}

/**
 * Paint every occurrence of the search text inside the transcript. The list is virtual and the
 * assistant keeps writing into it, so the ranges are collected again whenever the rows change
 * or the view scrolls; one frame is the fastest this can repeat.
 */
export function useSearchHighlight(root: RefObject<HTMLElement | null>, query: string, activeEntryId?: string): void {
	const needle = query.trim();
	const active = needle.length >= MIN_HIGHLIGHT_LENGTH && highlightsSupported();

	useEffect(() => {
		const element = root.current;
		if (!active || !element) {
			clearHighlight();
			return;
		}
		let frame = 0;
		const repaint = () => {
			frame = 0;
			const all = collectMatchRanges(element, needle);
			// The row the counter is naming, if it is rendered at all.
			const selector = activeEntryId === undefined ? undefined : `[data-entry-id="${cssEscape(activeEntryId)}"]`;
			const row = selector === undefined ? null : element.querySelector(selector);
			if (!row) {
				paintHighlight(all);
				return;
			}
			const active = all.filter((range) => row.contains(range.startContainer));
			paintHighlight(
				all.filter((range) => !row.contains(range.startContainer)),
				active,
			);
		};
		const schedule = () => {
			if (frame === 0) frame = requestAnimationFrame(repaint);
		};
		schedule();
		// Painting does not change the DOM, so watching it cannot feed itself.
		const observer = new MutationObserver(schedule);
		observer.observe(element, { childList: true, subtree: true, characterData: true });
		element.addEventListener("scroll", schedule, { passive: true });
		return () => {
			observer.disconnect();
			element.removeEventListener("scroll", schedule);
			if (frame !== 0) cancelAnimationFrame(frame);
			clearHighlight();
		};
	}, [root, needle, active, activeEntryId]);
}

import { type RefObject, useEffect, useRef } from "react";
import { clearHighlight, collectMatchRanges, highlightsSupported, paintHighlight } from "@/lib/text-highlight";

/** Below this a search marks nothing: two letters would light up half the transcript. */
export const MIN_HIGHLIGHT_LENGTH = 3;

/** pi's entry ids are plain, but a selector built from data never goes in unescaped. */
function cssEscape(value: string): string {
	const cssEscapeFn = (globalThis as { CSS?: { escape?: (input: string) => string } }).CSS?.escape;
	return cssEscapeFn ? cssEscapeFn(value) : value.replace(/["\\]/g, "\\$&");
}

/** Keep the marked word inside the view, with a little air above and below it. */
function scrollRangeIntoView(container: HTMLElement, range: Range): void {
	const rect = range.getBoundingClientRect();
	if (rect.height === 0 && rect.width === 0) return;
	const view = container.getBoundingClientRect();
	const margin = 64;
	if (rect.top >= view.top + margin && rect.bottom <= view.bottom - margin) return;
	container.scrollTop += rect.top - view.top - (view.height - rect.height) / 2;
}

/**
 * Paint every occurrence of the search text inside the transcript. The list is virtual and the
 * assistant keeps writing into it, so the ranges are collected again whenever the rows change
 * or the view scrolls; one frame is the fastest this can repeat.
 */
export function useSearchHighlight(
	root: RefObject<HTMLElement | null>,
	query: string,
	activeEntryId?: string,
	activeIndex = 0,
): void {
	const needle = query.trim();
	const active = needle.length >= MIN_HIGHLIGHT_LENGTH && highlightsSupported();
	// The hit already brought into view; scrolling repaints, so this must not repeat itself.
	const scrolledTo = useRef<string | undefined>(undefined);

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
			// The nth occurrence of that row, counted as the page shows them. Source order and
			// rendered order agree for text, shell output and tool results; where a card folds
			// something away the count can fall short, so it is clamped to what is on screen.
			const inRow = all.filter((range) => row.contains(range.startContainer));
			const current = inRow[Math.min(activeIndex, inRow.length - 1)];
			paintHighlight(
				all.filter((range) => range !== current),
				current ? [current] : [],
			);
			const key = `${activeEntryId}:${activeIndex}:${needle}`;
			if (current && scrolledTo.current !== key) {
				scrolledTo.current = key;
				scrollRangeIntoView(element, current);
			}
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
	}, [root, needle, active, activeEntryId, activeIndex]);
}

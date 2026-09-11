import { type RefObject, useEffect } from "react";
import { clearHighlight, collectMatchRanges, highlightsSupported, paintHighlight } from "@/lib/text-highlight";

/** Below this a search marks nothing: two letters would light up half the transcript. */
export const MIN_HIGHLIGHT_LENGTH = 3;

/**
 * Paint every occurrence of the search text inside the transcript. The list is virtual and the
 * assistant keeps writing into it, so the ranges are collected again whenever the rows change
 * or the view scrolls; one frame is the fastest this can repeat.
 */
export function useSearchHighlight(root: RefObject<HTMLElement | null>, query: string): void {
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
			paintHighlight(collectMatchRanges(element, needle));
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
	}, [root, needle, active]);
}

import { useSyncExternalStore } from "react";

/** Below this width the sidebar becomes a drawer; keep in sync with `--breakpoint-md` in index.css. */
export const NARROW_QUERY = "(max-width: 899.98px)";

function subscribe(query: string, onChange: () => void): () => void {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
	const list = window.matchMedia(query);
	list.addEventListener("change", onChange);
	return () => list.removeEventListener("change", onChange);
}

function matches(query: string): boolean {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
	return window.matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
	return useSyncExternalStore(
		(onChange) => subscribe(query, onChange),
		() => matches(query),
		() => false,
	);
}

/** True on phone-sized layouts where the sidebar is an overlay. */
export function useNarrow(): boolean {
	return useMediaQuery(NARROW_QUERY);
}

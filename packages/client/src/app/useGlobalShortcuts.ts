import { useEffect } from "react";
import { matchShortcut } from "./shortcuts";

/**
 * App-wide keys. Which keys exist, when they apply and what they do lives in ./shortcuts.ts,
 * so the hotkeys overview and this handler can never disagree.
 */
export function useGlobalShortcuts(): void {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			const shortcut = matchShortcut(event);
			if (!shortcut?.run) return;
			event.preventDefault();
			shortcut.run();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
}

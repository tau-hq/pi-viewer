import { useCallback, useState } from "react";

// Virtualized rows unmount when scrolled away; keep expand/collapse choices across remounts.
const expandedByKey = new Map<string, boolean>();

export function useExpanded(key: string, initial: boolean): [boolean, (next?: boolean) => void] {
	const [value, setValue] = useState(() => expandedByKey.get(key) ?? initial);
	const toggle = useCallback(
		(next?: boolean) => {
			setValue((previous) => {
				const resolved = next ?? !previous;
				expandedByKey.set(key, resolved);
				return resolved;
			});
		},
		[key],
	);
	return [value, toggle];
}

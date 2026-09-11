import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Transcript } from "./Transcript";

/** How many transcripts stay built. Switching between more than this rebuilds the oldest. */
const KEEP = 3;

/** The sessions to keep mounted, the one being shown always among them, newest use last. */
export function recentlyShown(previous: readonly string[], sessionId: string, keep = KEEP): string[] {
	const next = [...previous.filter((id) => id !== sessionId), sessionId];
	return next.slice(Math.max(0, next.length - keep));
}

/**
 * Switching sessions must not cost a rebuild of the conversation. The last few transcripts stay
 * mounted and stacked; only the one being shown is visible. `invisible` rather than `hidden`:
 * the rows of a hidden transcript keep their size, so its scroll position and the virtual list
 * are still right when it comes back. The other parts of the screen are cheap to rebuild and
 * are keyed by session as before.
 */
export function TranscriptStack({ sessionId }: { sessionId: string }) {
	const [mounted, setMounted] = useState<string[]>(() => [sessionId]);
	// Keep the list in a ref as well, so the effect never needs the state as a dependency.
	const current = useRef(mounted);
	useEffect(() => {
		const next = recentlyShown(current.current, sessionId);
		if (next.length === current.current.length && next.every((id, index) => id === current.current[index])) return;
		current.current = next;
		setMounted(next);
	}, [sessionId]);

	return (
		<div className="relative min-h-0 flex-1">
			{mounted.map((id) => (
				<div
					key={id}
					aria-hidden={id !== sessionId}
					className={cn("absolute inset-0 flex flex-col", id !== sessionId && "invisible pointer-events-none")}
				>
					<Transcript sessionId={id} />
				</div>
			))}
		</div>
	);
}

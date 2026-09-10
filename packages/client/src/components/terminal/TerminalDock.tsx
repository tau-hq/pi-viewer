import {
	lazy,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	Suspense,
} from "react";
import { t } from "@/i18n";
import { TERMINAL_MIN_HEIGHT, useTerminalStore } from "@/store/terminal-store";
import { Spinner } from "../ui/spinner";

const TerminalPanel = lazy(() => import("./TerminalPanel"));

const KEYBOARD_STEP_PX = 24;
const MAX_VIEWPORT_FRACTION = 0.8;

function maxHeight(): number {
	return Math.max(TERMINAL_MIN_HEIGHT, Math.round(window.innerHeight * MAX_VIEWPORT_FRACTION));
}

/**
 * Resizable dock between transcript and composer. The panel body (xterm.js) is a lazy chunk;
 * the drag handle lives here so the height can be adjusted while that chunk still loads.
 */
export function TerminalDock({ cwd }: { cwd: string }) {
	const open = useTerminalStore((s) => s.open);
	const height = useTerminalStore((s) => s.height);
	if (!open) return null;

	const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		const startY = event.clientY;
		const startHeight = useTerminalStore.getState().height;
		const limit = maxHeight();
		const move = (moveEvent: PointerEvent) => {
			useTerminalStore.getState().setHeight(Math.min(limit, startHeight + (startY - moveEvent.clientY)), false);
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			const store = useTerminalStore.getState();
			store.setHeight(store.height);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
		const delta = event.key === "ArrowUp" ? KEYBOARD_STEP_PX : event.key === "ArrowDown" ? -KEYBOARD_STEP_PX : 0;
		if (delta === 0) return;
		event.preventDefault();
		const store = useTerminalStore.getState();
		store.setHeight(Math.min(maxHeight(), store.height + delta));
	};

	return (
		<div
			data-testid="terminal-dock"
			className="flex shrink-0 flex-col border-border border-t bg-background"
			style={{ height: `${height}px` }}
		>
			{/* A button, not a separator role: it is the drag handle and answers the arrow keys. */}
			<button
				type="button"
				data-testid="terminal-resize"
				aria-label={t("terminal.resize")}
				title={t("terminal.resize")}
				onPointerDown={onPointerDown}
				onKeyDown={onKeyDown}
				className="h-2 w-full shrink-0 cursor-row-resize touch-none hover:bg-primary/30 focus-visible:bg-primary/40 focus-visible:outline-none"
			/>
			<Suspense
				fallback={
					<div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground text-xs">
						<Spinner /> {t("terminal.loading")}
					</div>
				}
			>
				<TerminalPanel cwd={cwd} />
			</Suspense>
		</div>
	);
}

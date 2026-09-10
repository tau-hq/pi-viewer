import type { Widget } from "@pi-tau/shared";
import { stripAnsi } from "@/lib/ansi";
import { useSessionStore } from "@/store/session-store";

const EMPTY: Record<string, Widget> = {};

/** Extension widgets (plain text lines, ANSI stripped) above or below the composer. */
export function WidgetBlocks({ sessionId, placement }: { sessionId: string; placement: Widget["placement"] }) {
	const widgets = useSessionStore((s) => s.views[sessionId]?.widgets ?? EMPTY);
	const entries = Object.entries(widgets)
		.filter(([, widget]) => widget.placement === placement && widget.lines.length > 0)
		.sort(([a], [b]) => a.localeCompare(b));
	if (entries.length === 0) return null;
	return (
		<div className="flex flex-col gap-1.5">
			{entries.map(([key, widget]) => (
				<pre
					key={key}
					title={key}
					className="max-h-40 overflow-auto rounded-md border border-border bg-card px-3 py-2 font-mono text-[12px] text-muted-foreground leading-snug"
				>
					{widget.lines.map(stripAnsi).join("\n")}
				</pre>
			))}
		</div>
	);
}

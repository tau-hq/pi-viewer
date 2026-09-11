import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/store/session-store";
import { useUiStore } from "@/store/ui-store";
import { StreamingRow } from "./AssistantMessage";
import { LiveBashRow } from "./BashExecutionCard";
import { MessageRow } from "./MessageRow";
import { buildRows, type TranscriptRow } from "./rows";
import { useSearchHighlight } from "./useSearchHighlight";

const BOTTOM_THRESHOLD_PX = 48;
const EMPTY: never[] = [];

function RowView({ sessionId, row }: { sessionId: string; row: TranscriptRow }) {
	switch (row.kind) {
		case "message":
			return <MessageRow sessionId={sessionId} message={row.message} />;
		case "streaming":
			return <StreamingRow sessionId={sessionId} />;
		case "bashRun":
			return <LiveBashRow sessionId={sessionId} />;
	}
}

/** Virtualized transcript that sticks to the bottom while the user is there. */
export function Transcript({ sessionId }: { sessionId: string }) {
	const messages = useSessionStore((s) => s.views[sessionId]?.messages ?? EMPTY);
	const streamingId = useSessionStore((s) => s.views[sessionId]?.streaming?.id);
	const bashRunId = useSessionStore((s) => s.views[sessionId]?.bashRun?.commandId);
	// Length of the streaming content drives the stick-to-bottom effect each frame.
	const streamingSize = useSessionStore((s) => {
		const view = s.views[sessionId];
		let size = view?.bashRun?.output.length ?? 0;
		for (const block of view?.streaming?.content ?? []) {
			size += block.type === "text" ? block.text.length : block.type === "thinking" ? block.thinking.length : 1;
		}
		return size;
	});

	const rows = useMemo(() => {
		const list = buildRows(messages);
		if (streamingId !== undefined) list.push({ kind: "streaming", key: `streaming:${streamingId}` });
		if (bashRunId !== undefined) list.push({ kind: "bashRun", key: `bash:${bashRunId}` });
		return list;
	}, [messages, streamingId, bashRunId]);

	const scrollRef = useRef<HTMLDivElement>(null);
	// Offset saved when this session was last shown; undefined means it was following the bottom.
	const restoreRef = useRef<number | undefined>(useUiStore.getState().scrollOffsets[sessionId]);
	const lastScrollTop = useRef(restoreRef.current ?? 0);
	const atBottomRef = useRef(restoreRef.current === undefined);
	const [atBottom, setAtBottom] = useState(atBottomRef.current);

	useEffect(
		() => () => {
			useUiStore.getState().setScrollOffset(sessionId, atBottomRef.current ? undefined : lastScrollTop.current);
		},
		[sessionId],
	);

	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 96,
		overscan: 6,
		getItemKey: (index) => rows[index]?.key ?? index,
		paddingStart: 16,
		paddingEnd: 24,
	});

	const scrollToBottom = useCallback(() => {
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, []);

	const onScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		lastScrollTop.current = el.scrollTop;
		const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
		const next = distance < BOTTOM_THRESHOLD_PX;
		if (next !== atBottomRef.current) {
			atBottomRef.current = next;
			setAtBottom(next);
		}
	};

	const totalSize = virtualizer.getTotalSize();
	// Changes whenever content grows or rows are measured; re-pin to the end while following.
	const contentVersion = `${totalSize}:${rows.length}:${streamingSize}`;
	useLayoutEffect(() => {
		if (contentVersion && atBottomRef.current) scrollToBottom();
	}, [contentVersion, scrollToBottom]);

	// Initial layout: measurements arrive over a few frames, keep pinning to the end (or the saved offset).
	useEffect(() => {
		let frames = 0;
		let handle = 0;
		const pin = () => {
			const el = scrollRef.current;
			if (restoreRef.current !== undefined) {
				if (el) el.scrollTop = restoreRef.current;
			} else if (atBottomRef.current) scrollToBottom();
			if (++frames < 6) handle = requestAnimationFrame(pin);
			else restoreRef.current = undefined;
		};
		handle = requestAnimationFrame(pin);
		return () => cancelAnimationFrame(handle);
	}, [scrollToBottom]);

	// A search hit scrolls the row into the middle and marks it briefly; the row may still be
	// unmeasured, so the scroll is repeated for a few frames while the estimate settles.
	const reveal = useUiStore((s) => (s.reveal?.sessionId === sessionId ? s.reveal : undefined));
	const [flashKey, setFlashKey] = useState<string | undefined>(undefined);
	useEffect(() => {
		if (!reveal) return;
		const index = rows.findIndex((row) => row.kind === "message" && row.message.id === reveal.entryId);
		if (index === -1) return;
		atBottomRef.current = false;
		setAtBottom(false);
		setFlashKey(rows[index]?.key);
		let frames = 0;
		let handle = requestAnimationFrame(function step() {
			virtualizer.scrollToIndex(index, { align: "center" });
			if (++frames < 8) handle = requestAnimationFrame(step);
		});
		const clear = setTimeout(() => setFlashKey(undefined), 2200);
		return () => {
			cancelAnimationFrame(handle);
			clearTimeout(clear);
		};
	}, [reveal, rows, virtualizer]);

	// While the search field is open, every occurrence of what is typed is marked in place.
	const searchQuery = useUiStore((s) => (s.searchOpen ? s.searchQuery : ""));
	const searchActiveEntry = useUiStore((s) => s.searchActiveEntry);
	const searchActiveIndex = useUiStore((s) => s.searchActiveIndex);
	useSearchHighlight(scrollRef, searchQuery, searchActiveEntry, searchActiveIndex);

	const items = virtualizer.getVirtualItems();

	return (
		<div className="relative min-h-0 flex-1">
			<div
				ref={scrollRef}
				onScroll={onScroll}
				data-testid="transcript-scroll"
				className="h-full overflow-y-auto overscroll-contain"
			>
				{rows.length === 0 ? (
					<div className="flex h-full items-center justify-center text-muted-foreground text-sm">
						{t("transcript.empty")}
					</div>
				) : (
					<div className="relative mx-auto w-full max-w-3xl px-4" style={{ height: totalSize }}>
						{items.map((item) => {
							const row = rows[item.index];
							if (!row) return null;
							return (
								<div
									key={item.key}
									data-index={item.index}
									data-entry-id={row.kind === "message" ? row.message.id : undefined}
									ref={virtualizer.measureElement}
									className={cn(
										"absolute top-0 left-0 w-full px-4 py-2",
										flashKey === row.key && "rounded-xl ring-2 ring-ring/60 transition-shadow duration-500",
									)}
									style={{ transform: `translateY(${item.start}px)` }}
								>
									<RowView sessionId={sessionId} row={row} />
								</div>
							);
						})}
					</div>
				)}
			</div>
			<button
				type="button"
				onClick={() => {
					atBottomRef.current = true;
					setAtBottom(true);
					scrollToBottom();
				}}
				className={cn(
					"absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-popover px-3 py-1 text-xs shadow-md transition-all hover:bg-accent",
					atBottom ? "pointer-events-none translate-y-2 opacity-0" : "opacity-100",
				)}
				aria-hidden={atBottom}
				tabIndex={atBottom ? -1 : 0}
			>
				<ArrowDown className="size-3.5" />
				{t("transcript.jumpToLatest")}
			</button>
		</div>
	);
}

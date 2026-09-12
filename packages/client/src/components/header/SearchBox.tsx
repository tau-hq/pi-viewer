import type { MessageRole, SearchMatch, TreeNode } from "@pi-tau/shared";
import { ChevronDown, ChevronUp, GitBranch, History, Loader2, Search, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { type TKey, t } from "@/i18n";
import { asRecord, pickArray } from "@/lib/result-data";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/store/session-store";
import { useSessionsStore } from "@/store/sessions-store";
import { toast, useUiStore } from "@/store/ui-store";
import { landingForHit } from "../dialogs/tree";

const DEBOUNCE_MS = 180;
// High enough that the counter next to the field is the real number of hits, not a cap.
const LIMIT = 500;

const ROLE_LABEL: Partial<Record<MessageRole | "other", TKey>> = {
	user: "search.roleUser",
	assistant: "search.roleAssistant",
	toolResult: "search.roleTool",
	bashExecution: "search.roleBash",
	compactionSummary: "search.roleCompaction",
	branchSummary: "search.roleBranch",
};

/** The hit being looked at is orange, the rest yellow; the list says the same as the transcript. */
function markClass(current: boolean): string {
	return current
		? "bg-search-hit-active text-search-hit-active-foreground"
		: "bg-search-hit text-search-hit-foreground";
}

function isMatch(value: unknown): value is SearchMatch {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return typeof record.entryId === "string" && typeof record.preview === "string" && typeof record.index === "number";
}

/** The hit, marked inside its line, so the eye finds it without reading the whole preview. */
function Preview({ match, current }: { match: SearchMatch; current: boolean }) {
	const start = Math.max(0, Math.min(match.offset, match.preview.length));
	const end = Math.min(match.preview.length, start + match.length);
	return (
		<span className="block truncate">
			{match.preview.slice(0, start)}
			<mark className={cn("rounded-sm", markClass(current))}>{match.preview.slice(start, end)}</mark>
			{match.preview.slice(end)}
		</span>
	);
}

/**
 * Search across the whole session, not across what happens to be on screen: the host reads
 * every entry from pi, so abandoned branches and history that a compaction replaced are found
 * too. The icon grows into the field, which is why both live in the same box.
 */
export function SearchBox({ sessionId }: { sessionId: string }) {
	const open = useUiStore((s) => s.searchOpen);
	const nonce = useUiStore((s) => s.searchNonce);
	const openSearch = useUiStore((s) => s.openSearch);
	const closeSearch = useUiStore((s) => s.closeSearch);
	const revealEntry = useUiStore((s) => s.revealEntry);
	const command = useSessionsStore((s) => s.command);
	// In the store, because the transcript marks every occurrence of it while the field is open.
	const query = useUiStore((s) => s.searchQuery);
	const setQuery = useUiStore((s) => s.setSearchQuery);
	const [matches, setMatches] = useState<SearchMatch[]>([]);
	const [truncated, setTruncated] = useState(false);
	const [busy, setBusy] = useState(false);
	const [active, setActive] = useState(0);
	/** False until the user has stepped once, so the first step goes to hit one, not to two. */
	const [visited, setVisited] = useState(false);
	const [ran, setRan] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	// The transcript marks the hit this names in the second colour.
	const setSearchActive = useUiStore((s) => s.setSearchActive);
	useEffect(() => {
		const match = matches[active];
		setSearchActive(match?.entryId, match?.index ?? 0);
	}, [matches, active, setSearchActive]);

	// This box is keyed by session, so a mount means another session and another set of entries.
	useEffect(() => {
		setQuery("");
	}, [setQuery]);

	// Every open request focuses, so the shortcut works on an already visible field.
	useEffect(() => {
		if (nonce > 0 && open) inputRef.current?.select();
	}, [nonce, open]);

	useEffect(() => {
		const text = query.trim();
		if (!open || text.length === 0) {
			setMatches([]);
			setRan(false);
			setBusy(false);
			return;
		}
		setBusy(true);
		let cancelled = false;
		const handle = setTimeout(() => {
			command({ type: "search", query: text, limit: LIMIT })
				.then((data) => {
					if (cancelled) return;
					setMatches(pickArray<unknown>(data, "matches").filter(isMatch));
					setTruncated(asRecord(data)?.truncated === true);
					setActive(0);
					setVisited(false);
					setRan(true);
				})
				.catch((error: unknown) => {
					if (cancelled) return;
					setMatches([]);
					setRan(true);
					toast("error", error instanceof Error ? error.message : String(error));
				})
				.finally(() => {
					if (!cancelled) setBusy(false);
				});
		}, DEBOUNCE_MS);
		return () => {
			cancelled = true;
			clearTimeout(handle);
		};
	}, [open, query, command]);

	const close = () => {
		// closeSearch drops the query as well, so nothing stays marked in the transcript.
		closeSearch();
		setMatches([]);
		setRan(false);
		setVisited(false);
	};

	/**
	 * A hit the transcript is showing only needs a scroll. Anything else lives on another
	 * branch or before a compaction, and pi reaches it the way the session tree does.
	 * A hit on screen leaves the field open: the occurrences stay marked while it is, and
	 * closing right after a jump would take the marks away at the moment they are wanted.
	 */
	const jump = (match: SearchMatch) => {
		const view = useSessionStore.getState().views[sessionId];
		const shown = view?.messages.some((message) => message.id === match.entryId) ?? false;
		if (shown) {
			revealEntry(sessionId, match.entryId);
			// A click moves the focus onto the row; give it back, or the next key would be lost.
			inputRef.current?.focus();
			return;
		}
		// Moving the session to another branch always ends the search: it is a real change,
		// and repeating it by holding Enter would drag the session around. It lands at the end
		// of the answer the hit is in, never in the middle of one; see dialogs/tree.ts.
		void command({ type: "getTree" })
			.then((data) => {
				const entryId = landingForHit(pickArray<TreeNode>(data, "tree"), match.entryId) ?? match.entryId;
				return command({ type: "navigateTree", entryId });
			})
			.then(() => {
				revealEntry(sessionId, match.entryId);
				toast("info", t("search.navigated"));
				close();
			})
			.catch((error: unknown) => toast("error", error instanceof Error ? error.message : String(error)));
	};

	/**
	 * Walk the hits the way a find bar does: one step forward or back, wrapping at both ends,
	 * and the transcript scrolls to the hit if it is on the branch being shown. Stepping never
	 * moves the session to another branch - that needs the deliberate click on the row.
	 */
	const step = (delta: number) => {
		if (matches.length === 0) return;
		const next = visited ? (active + delta + matches.length) % matches.length : delta > 0 ? 0 : matches.length - 1;
		const previous = matches[active]?.entryId;
		setActive(next);
		setVisited(true);
		const match = matches[next];
		if (!match) return;
		// Only when the step lands in another message. Inside one, the transcript scrolls to the
		// marked word itself, and flashing the same message on every step would be noise.
		if (visited && match.entryId === previous) return;
		const view = useSessionStore.getState().views[sessionId];
		if (view?.messages.some((message) => message.id === match.entryId)) revealEntry(sessionId, match.entryId);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			close();
		} else if (event.key === "ArrowDown" || event.key === "Enter") {
			event.preventDefault();
			step(1);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			step(-1);
		}
	};

	return (
		<div
			data-testid="header-search"
			className={cn(
				"relative flex h-8 shrink-0 items-center transition-[width] duration-200 ease-out",
				open ? "w-44 md:w-[22rem]" : "w-8",
			)}
		>
			<button
				type="button"
				aria-label={t("search.open")}
				title={`${t("search.open")} · Ctrl+F`}
				data-testid="search-toggle"
				onClick={openSearch}
				tabIndex={open ? -1 : 0}
				className={cn(
					"absolute left-0 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors",
					open ? "pointer-events-none" : "hover:bg-accent hover:text-accent-foreground",
				)}
			>
				{busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
			</button>
			<input
				ref={inputRef}
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={onKeyDown}
				placeholder={t("search.placeholder")}
				aria-label={t("search.placeholder")}
				data-testid="search-input"
				tabIndex={open ? 0 : -1}
				aria-hidden={!open}
				className={cn(
					// `invisible` rather than a bare opacity: a field nobody can see must be out of
					// reach for the caret and for assistive technology as well. Visibility is
					// deliberately not part of the transition, or the shortcut would try to focus a
					// field that is still hidden for the first half of the fade.
					"h-8 w-full rounded-md border border-input bg-background pr-8 pl-8 text-sm outline-none transition-opacity duration-150 placeholder:text-muted-foreground focus-visible:border-ring",
					matches.length > 0 && "md:pr-28",
					open ? "visible opacity-100" : "invisible pointer-events-none opacity-0",
				)}
			/>
			{open && matches.length > 0 && (
				// Never a focus change: the caret has to stay in the field while the hits are walked.
				<div className="absolute right-8 flex items-center gap-0.5 max-md:hidden">
					<span data-testid="search-count" className="px-1 text-[11px] text-muted-foreground tabular-nums">
						{active + 1}/{matches.length}
						{truncated ? "+" : ""}
					</span>
					<button
						type="button"
						aria-label={t("search.previous")}
						data-testid="search-previous"
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => step(-1)}
						className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						<ChevronUp className="size-3.5" />
					</button>
					<button
						type="button"
						aria-label={t("search.next")}
						data-testid="search-next"
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => step(1)}
						className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						<ChevronDown className="size-3.5" />
					</button>
				</div>
			)}
			{open && (
				<button
					type="button"
					aria-label={t("ui.close")}
					data-testid="search-close"
					onClick={close}
					className="absolute right-0 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
				>
					<X className="size-3.5" />
				</button>
			)}
			{open && query.trim().length > 0 && (ran || matches.length > 0) && (
				<div
					data-testid="search-results"
					className="absolute top-9 right-0 z-30 w-[22rem] overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
				>
					{matches.length === 0 ? (
						<p className="px-3 py-4 text-center text-muted-foreground text-xs">{t("search.noMatch")}</p>
					) : (
						<>
							<div className="max-h-80 overflow-y-auto p-1">
								{matches.map((match, index) => (
									<button
										type="button"
										key={`${match.entryId}:${match.index}`}
										data-testid="search-result"
										onMouseEnter={() => setActive(index)}
										onClick={() => jump(match)}
										title={match.onActivePath ? undefined : t("search.otherBranch")}
										className={cn(
											"flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left",
											index === active && "bg-accent text-accent-foreground",
										)}
									>
										<span className="flex w-full items-center gap-1.5 text-[11px] text-muted-foreground">
											<span className="uppercase tracking-wide">{t(ROLE_LABEL[match.role] ?? "search.roleOther")}</span>
											{!match.onActivePath && <GitBranch className="size-3" />}
											<span className="flex-1" />
											<span className="tabular-nums">{new Date(match.timestamp).toLocaleString()}</span>
										</span>
										<span className="w-full min-w-0 text-xs">
											<Preview match={match} current={index === active} />
										</span>
									</button>
								))}
							</div>
							<div className="flex items-center gap-1.5 border-border border-t px-2.5 py-1.5 text-[11px] text-muted-foreground">
								<History className="size-3" />
								{truncated
									? t("search.countTruncated", { count: matches.length })
									: matches.length === 1
										? t("search.countOne")
										: t("search.count", { count: matches.length })}
							</div>
						</>
					)}
				</div>
			)}
		</div>
	);
}

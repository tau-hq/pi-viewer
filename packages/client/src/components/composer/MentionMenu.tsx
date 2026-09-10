import type { FileMatch } from "@pi-tau/shared";
import { File, Folder } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/i18n";
import { pickArray } from "@/lib/result-data";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/store/connection-store";
import { useSessionStore } from "@/store/session-store";
import { getTransport } from "@/transport/transport";
import { findMention, type MentionContext, mentionLabel } from "./mentions";

const DEBOUNCE_MS = 120;
const LIMIT = 12;

export interface MentionMenuState {
	open: boolean;
	/** The token an accepted path replaces; undefined while no mention is being typed. */
	mention: MentionContext | undefined;
	files: FileMatch[];
	/** True while the answer for the current query is still on its way. */
	loading: boolean;
	active: number;
	setActive: (index: number) => void;
	move: (delta: number) => void;
	/** Close the popup for the token as it stands; typing on reopens it. */
	dismiss: () => void;
}

/**
 * Project-file completion for `@` mentions: the host searches (gitignore aware) after a short
 * pause, stale answers are dropped, and the previous list stays visible while the next one loads
 * so the popup never flickers. Typing is never blocked; a failed search shows the empty state.
 */
export function useMentionMenu(sessionId: string, value: string, caret: number, enabled: boolean): MentionMenuState {
	const sessionCwd = useSessionStore((s) => s.views[sessionId]?.state.cwd);
	const defaultCwd = useConnectionStore((s) => s.host?.defaultCwd);
	const cwd = sessionCwd || defaultCwd || "";
	const mention = useMemo(() => (enabled ? findMention(value, caret) : undefined), [enabled, value, caret]);
	const query = mention?.query;
	const token = mention ? `${mention.start}:${mention.query}` : "";
	const [result, setResult] = useState<{ query: string; files: FileMatch[] } | undefined>(undefined);
	const [dismissed, setDismissed] = useState<string | undefined>(undefined);
	// The highlight belongs to the token it was made for; a new query starts at the top again.
	const [selection, setSelection] = useState({ token, index: 0 });
	const request = useRef(0);

	useEffect(() => {
		if (query === undefined || !cwd) return;
		const seq = ++request.current;
		const timer = setTimeout(() => {
			getTransport()
				.send({ type: "fs.searchFiles", cwd, query, limit: LIMIT })
				.then((data) => {
					if (seq === request.current) setResult({ query, files: pickArray<FileMatch>(data, "files") });
				})
				.catch(() => {
					if (seq === request.current) setResult({ query, files: [] });
				});
		}, DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query, cwd]);

	const files = query === undefined ? [] : (result?.files ?? []);
	const active = selection.token === token ? Math.min(selection.index, Math.max(0, files.length - 1)) : 0;

	return {
		open: mention !== undefined && dismissed !== token,
		mention,
		files,
		loading: result?.query !== query,
		active,
		setActive: (index) => setSelection({ token, index }),
		move: (delta) => setSelection({ token, index: Math.max(0, Math.min(files.length - 1, active + delta)) }),
		dismiss: () => setDismissed(token),
	};
}

/**
 * The popup's keys, taken before the editor sees them: ↑↓ move, Enter or Tab accept, Esc closes.
 * Returns true when the keystroke belonged to the popup.
 */
export function handleMentionKey(
	event: KeyboardEvent<HTMLTextAreaElement>,
	menu: MentionMenuState,
	onPick: (file: FileMatch) => void,
): boolean {
	if (!menu.open) return false;
	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		menu.move(event.key === "ArrowDown" ? 1 : -1);
		return true;
	}
	if ((event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) && menu.files.length > 0) {
		event.preventDefault();
		const file = menu.files[menu.active];
		if (file) onPick(file);
		return true;
	}
	// Esc closes the popup only; the text of the mention stays as it was typed.
	if (event.key === "Escape") {
		event.preventDefault();
		menu.dismiss();
		return true;
	}
	return false;
}

interface MentionMenuProps {
	menu: MentionMenuState;
	onPick: (file: FileMatch) => void;
}

/** File list above the composer; same look and keyboard handling as the slash menu. */
export function MentionMenu({ menu, onPick }: MentionMenuProps) {
	const activeRef = useRef<HTMLButtonElement>(null);
	const active = menu.active;
	// Keep the highlighted entry in view while the arrow keys walk a long list.
	useEffect(() => {
		if (active >= 0) activeRef.current?.scrollIntoView({ block: "nearest" });
	}, [active]);

	return (
		<div
			role="listbox"
			data-testid="mention-menu"
			className="absolute right-0 bottom-full left-0 z-20 mb-2 max-h-72 animate-in overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
		>
			{menu.files.length === 0 && (
				<p className="px-3 py-3 text-center text-muted-foreground text-xs">
					{menu.loading ? t("mention.searching") : t("mention.empty")}
				</p>
			)}
			{menu.files.map((file, index) => {
				const label = mentionLabel(file.path);
				return (
					<button
						type="button"
						role="option"
						data-testid="mention-item"
						aria-selected={index === menu.active}
						ref={index === menu.active ? activeRef : undefined}
						key={file.path}
						onMouseEnter={() => menu.setActive(index)}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => onPick(file)}
						className={cn(
							"flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm",
							index === menu.active && "bg-accent text-accent-foreground",
						)}
					>
						{file.isDirectory ? (
							<Folder className="size-3.5 shrink-0 text-primary" />
						) : (
							<File className="size-3.5 shrink-0 text-muted-foreground" />
						)}
						<span className="shrink-0 font-mono font-semibold text-[13px]">{label.name}</span>
						<span className="min-w-0 flex-1 truncate text-right font-mono text-muted-foreground text-xs">
							{label.dir}
						</span>
					</button>
				);
			})}
		</div>
	);
}

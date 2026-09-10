import type { SessionSummary } from "@pi-tau/shared";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Search } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { t } from "@/i18n";
import { basename, relativeTime } from "@/lib/format";
import { matchesQuery, sessionLabel } from "@/lib/session-match";
import { cn } from "@/lib/utils";
import { useSessionsStore } from "@/store/sessions-store";
import { toast, useUiStore } from "@/store/ui-store";
import { Dialog, DialogContent } from "../ui/dialog";

export function QuickSwitcher() {
	const open = useUiStore((s) => s.dialog === "quickSwitcher");
	const closeDialog = useUiStore((s) => s.closeDialog);
	const sessions = useSessionsStore((s) => s.sessions);
	const openSession = useSessionsStore((s) => s.open);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);

	useEffect(() => {
		if (open) {
			setQuery("");
			setActive(0);
		}
	}, [open]);

	const matches = useMemo(() => sessions.filter((s) => matchesQuery(s, query)).slice(0, 50), [sessions, query]);

	const choose = (session: SessionSummary | undefined) => {
		if (!session) return;
		closeDialog();
		openSession(session).catch((error: unknown) =>
			toast("error", t("toast.commandFailed", { command: "sessions.open", message: String(error) })),
		);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActive((i) => Math.min(matches.length - 1, i + 1));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setActive((i) => Math.max(0, i - 1));
		} else if (event.key === "Enter") {
			event.preventDefault();
			choose(matches[active]);
		}
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
			<DialogContent hideClose className="top-[18%] translate-y-0 gap-0 p-0" size="md">
				<DialogPrimitive.Title className="sr-only">{t("quickSwitcher.placeholder")}</DialogPrimitive.Title>
				<div className="flex items-center gap-2 border-border border-b px-3">
					<Search className="size-4 text-muted-foreground" />
					<input
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setActive(0);
						}}
						onKeyDown={onKeyDown}
						placeholder={t("quickSwitcher.placeholder")}
						className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
					/>
				</div>
				<ul className="max-h-80 overflow-y-auto p-1">
					{matches.length === 0 && (
						<li className="px-3 py-6 text-center text-muted-foreground text-sm">{t("quickSwitcher.empty")}</li>
					)}
					{matches.map((session, index) => (
						<li key={session.path}>
							<button
								type="button"
								onMouseEnter={() => setActive(index)}
								onClick={() => choose(session)}
								className={cn(
									"flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm",
									index === active && "bg-accent text-accent-foreground",
								)}
							>
								<span className="min-w-0 flex-1 truncate">{sessionLabel(session)}</span>
								<span className="shrink-0 truncate text-muted-foreground text-xs">{basename(session.cwd)}</span>
								<span className="w-8 shrink-0 text-right text-muted-foreground text-xs">
									{relativeTime(session.modified)}
								</span>
							</button>
						</li>
					))}
				</ul>
				<div className="border-border border-t px-3 py-1.5 text-[11px] text-muted-foreground">
					{t("quickSwitcher.hint")}
				</div>
			</DialogContent>
		</Dialog>
	);
}

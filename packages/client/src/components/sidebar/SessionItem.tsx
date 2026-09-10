import type { SessionSummary } from "@pi-tau/shared";
import { Download, Ellipsis, FileDown, Pencil, Square, Trash } from "lucide-react";
import { t } from "@/i18n";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/store/session-store";
import { useUiStore } from "@/store/ui-store";
import { sessionLabel } from "../dialogs/QuickSwitcher";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { SessionStatusDot } from "./SessionStatusDot";
import { sessionStatus } from "./session-status";

export interface SessionActions {
	onOpen: (session: SessionSummary) => void;
	onRename: (session: SessionSummary) => void;
	onDelete: (session: SessionSummary) => void;
	onExport: (session: SessionSummary) => void;
	onExportJsonl: (session: SessionSummary) => void;
	onStop: (session: SessionSummary) => void;
}

interface SessionItemProps extends SessionActions {
	session: SessionSummary;
	active: boolean;
}

export function SessionItem({
	session,
	active,
	onOpen,
	onRename,
	onDelete,
	onExport,
	onExportJsonl,
	onStop,
}: SessionItemProps) {
	// The live view of a session is addressed by the host handle, which differs from the file's
	// own session id once a clone or fork has written a new file.
	const liveKey = session.handle ?? session.id;
	// `state` changes per state.update, not per streamed token, so the row stays cheap.
	const liveState = useSessionStore((s) => s.views[liveKey]?.state);
	const pendingUi = useSessionStore((s) => s.views[liveKey]?.pendingUi.length ?? 0);
	const seenAt = useUiStore((s) => s.seen[session.id]);
	const status = sessionStatus(session, liveState ? { ...liveState, pendingUi } : undefined, seenAt);
	// Whether a pi process happens to be attached is bookkeeping, not a state of the session:
	// it stays out of the row and only decides whether the menu offers "Stop process".
	const running = liveState?.processAlive ?? session.running;

	return (
		<div
			className={cn(
				"group relative flex items-center rounded-md text-sm transition-colors",
				active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
			)}
		>
			<button
				type="button"
				data-testid="session-item"
				data-session-path={session.path}
				data-active={active}
				onClick={() => onOpen(session)}
				className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-7 pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
				title={session.firstMessage || undefined}
			>
				<SessionStatusDot status={status} />
				<span className="min-w-0 flex-1 truncate">{sessionLabel(session)}</span>
				<span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
					{relativeTime(session.modified)}
				</span>
			</button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						aria-label={t("sidebar.actions")}
						className={cn(
							"absolute right-1 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-background/60 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100",
							active && "opacity-100",
						)}
					>
						<Ellipsis className="size-4" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={() => onRename(session)}>
						<Pencil /> {t("sidebar.rename")}
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => onExport(session)}>
						<Download /> {t("sidebar.exportHtml")}
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => onExportJsonl(session)}>
						<FileDown /> {t("sidebar.exportJsonl")}
					</DropdownMenuItem>
					{running && (
						<DropdownMenuItem onSelect={() => onStop(session)}>
							<Square /> {t("sidebar.closeProcess")}
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator />
					<DropdownMenuItem destructive onSelect={() => onDelete(session)}>
						<Trash /> {t("sidebar.delete")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

import type { SessionSummary } from "@pi-tau/shared";
import { Download, Ellipsis, FileDown, Pencil, Square, Trash } from "lucide-react";
import { t } from "@/i18n";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/store/session-store";
import { sessionLabel } from "../dialogs/QuickSwitcher";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";

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
	const liveStreaming = useSessionStore((s) => s.views[session.id]?.state.isStreaming ?? false);
	const liveAlive = useSessionStore((s) => s.views[session.id]?.state.processAlive);
	const streaming = liveStreaming || session.isStreaming;
	const running = liveAlive ?? session.running;

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
				<span
					aria-hidden
					className={cn(
						"size-1.5 shrink-0 rounded-full",
						streaming ? "animate-glow bg-primary" : running ? "bg-success" : "bg-transparent",
					)}
				/>
				{(streaming || running) && (
					<span className="sr-only">{streaming ? t("sidebar.streaming") : t("sidebar.running")}</span>
				)}
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

import type { SessionSummary } from "@pi-tau/shared";
import { Ellipsis } from "lucide-react";
import { t } from "@/i18n";
import { relativeTime } from "@/lib/format";
import { isPendingPath, sessionLabel } from "@/lib/session-match";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/store/session-store";
import { useUiStore } from "@/store/ui-store";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "../ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../ui/dropdown-menu";
import type { SessionActions, SidebarDrag } from "./actions";
import { CONTEXT_KIT, DROPDOWN_KIT } from "./menu-kit";
import { SessionMenuItems } from "./SessionMenuItems";
import { SessionStatusDot } from "./SessionStatusDot";
import { sessionStatus } from "./session-status";

interface SessionItemProps {
	session: SessionSummary;
	active: boolean;
	actions: SessionActions;
	drag: SidebarDrag;
}

export function SessionItem({ session, active, actions, drag }: SessionItemProps) {
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
	// A session pi has not written yet has no path the host could file under a group.
	const draggable = !isPendingPath(session.path);
	const dragged = drag.dragging?.path === session.path;

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: filing a session by dragging is pointer-only; the same move is in the row's own menu */}
				<div
					draggable={draggable}
					onDragStart={(event) => {
						// The payload matters to other drop zones only; the sidebar reads the store.
						event.dataTransfer.setData("text/plain", session.path);
						event.dataTransfer.effectAllowed = "move";
						drag.begin(session);
					}}
					onDragEnd={drag.end}
					className={cn(
						"group relative flex items-center rounded-md text-sm transition-colors",
						active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
						dragged && "opacity-50 ring-1 ring-ring",
					)}
				>
					<button
						type="button"
						data-testid="session-item"
						data-session-path={session.path}
						data-active={active}
						data-dragging={dragged || undefined}
						onClick={() => actions.onOpen(session)}
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
							<SessionMenuItems menu={DROPDOWN_KIT} session={session} running={running} actions={actions} />
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent data-testid="session-context-menu">
				<SessionMenuItems menu={CONTEXT_KIT} session={session} running={running} actions={actions} />
			</ContextMenuContent>
		</ContextMenu>
	);
}

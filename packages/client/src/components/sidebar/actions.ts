import type { SessionSummary } from "@pi-tau/shared";
import { t } from "@/i18n";
import { toast } from "@/store/ui-store";
import type { DropTarget } from "./drop-target";
import type { SidebarGroup } from "./grouping";

/** Rejection handler for a fire-and-forget command of the sidebar. */
export function commandFailure(command: string): (error: unknown) => void {
	return (error: unknown) =>
		toast(
			"error",
			t("toast.commandFailed", { command, message: error instanceof Error ? error.message : String(error) }),
		);
}

/** Everything the row of a session offers, in the "…" menu and in the right-click menu alike. */
export interface SessionActions {
	onOpen: (session: SessionSummary) => void;
	onRename: (session: SessionSummary) => void;
	onDelete: (session: SessionSummary) => void;
	onExport: (session: SessionSummary) => void;
	onExportJsonl: (session: SessionSummary) => void;
	onStop: (session: SessionSummary) => void;
	onClone: (session: SessionSummary) => void;
	/** File the session under a group, or back under its project with null. */
	onAssign: (session: SessionSummary, groupId: string | null) => void;
	/** Ask for a name, create the group and move the session into it. */
	onNewGroupWith: (session: SessionSummary) => void;
}

/** Everything a group header offers. A project header only answers the first two. */
export interface GroupActions {
	onNewSession: (group: SidebarGroup) => void;
	onNewGroup: () => void;
	onRenameGroup: (group: SidebarGroup, name: string) => void;
	onMoveGroup: (group: SidebarGroup, direction: "up" | "down") => void;
	onDeleteGroup: (group: SidebarGroup) => void;
}

/** The one session being dragged, and which group is currently under the pointer. */
export interface SidebarDrag {
	dragging: SessionSummary | undefined;
	dropKey: string | undefined;
	begin: (session: SessionSummary) => void;
	end: () => void;
	over: (key: string) => void;
	leave: (key: string) => void;
	drop: (target: DropTarget) => void;
}

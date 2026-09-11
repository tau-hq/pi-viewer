import { ArrowDown, ArrowUp, FolderPlus, Pencil, Plus, RotateCcw, Trash } from "lucide-react";
import { t } from "@/i18n";
import { useGroupsStore } from "@/store/groups-store";
import type { GroupActions } from "./actions";
import { movedGroupOrder, type SidebarGroup } from "./grouping";
import type { MenuKit } from "./menu-kit";

interface GroupMenuItemsProps {
	menu: MenuKit;
	group: SidebarGroup;
	actions: GroupActions;
	/** Starts the inline editor in the header; the commit goes through `actions.onRenameGroup`. */
	onStartRename: () => void;
}

/**
 * What a group header offers. Every header can be renamed; a project group is not the user's
 * to reorder or delete, and it can drop its name to show the folder name again.
 */
export function GroupMenuItems({ menu, group, actions, onStartRename }: GroupMenuItemsProps) {
	const groups = useGroupsStore((s) => s.groups);
	const id = group.groupId;
	return (
		<>
			<menu.Item onSelect={() => actions.onNewSession(group)}>
				<Plus /> {t("groups.newSession")}
			</menu.Item>
			<menu.Item onSelect={onStartRename}>
				<Pencil /> {t("groups.rename")}
			</menu.Item>
			{group.named === true && (
				<menu.Item onSelect={() => actions.onResetGroupName(group)}>
					<RotateCcw /> {t("groups.resetName")}
				</menu.Item>
			)}
			<menu.Item onSelect={() => actions.onNewGroup()}>
				<FolderPlus /> {t("groups.create")}
			</menu.Item>
			{id !== undefined && (
				<>
					<menu.Separator />
					{movedGroupOrder(groups, id, "up") !== undefined && (
						<menu.Item onSelect={() => actions.onMoveGroup(group, "up")}>
							<ArrowUp /> {t("groups.moveUp")}
						</menu.Item>
					)}
					{movedGroupOrder(groups, id, "down") !== undefined && (
						<menu.Item onSelect={() => actions.onMoveGroup(group, "down")}>
							<ArrowDown /> {t("groups.moveDown")}
						</menu.Item>
					)}
					<menu.Separator />
					<menu.Item destructive onSelect={() => actions.onDeleteGroup(group)}>
						<Trash /> {t("groups.delete")}
					</menu.Item>
				</>
			)}
		</>
	);
}

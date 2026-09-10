import { ArrowDown, ArrowUp, FolderPlus, Pencil, Plus, Trash } from "lucide-react";
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
 * What a group header offers. A project group is not the user's to rename, reorder or delete,
 * so it only offers the two items that create something.
 */
export function GroupMenuItems({ menu, group, actions, onStartRename }: GroupMenuItemsProps) {
	const groups = useGroupsStore((s) => s.groups);
	const id = group.groupId;
	return (
		<>
			<menu.Item onSelect={() => actions.onNewSession(group)}>
				<Plus /> {t("groups.newSession")}
			</menu.Item>
			{id !== undefined && (
				<menu.Item onSelect={onStartRename}>
					<Pencil /> {t("groups.rename")}
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

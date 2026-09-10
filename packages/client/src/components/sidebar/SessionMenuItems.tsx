import type { SessionSummary } from "@pi-tau/shared";
import {
	Copy,
	Download,
	FileDown,
	FolderInput,
	Pencil,
	Plus,
	Square,
	SquareArrowOutUpRight,
	Trash,
} from "lucide-react";
import { t } from "@/i18n";
import { useGroupsStore } from "@/store/groups-store";
import type { SessionActions } from "./actions";
import type { MenuKit } from "./menu-kit";

interface SessionMenuItemsProps {
	menu: MenuKit;
	session: SessionSummary;
	/** A pi process is attached, so the session can be stopped. */
	running: boolean;
	actions: SessionActions;
}

/**
 * What a session row offers. Rendered twice with the same items: once inside the "…" dropdown,
 * once inside the right-click menu.
 */
export function SessionMenuItems({ menu, session, running, actions }: SessionMenuItemsProps) {
	const groups = useGroupsStore((s) => s.groups);
	return (
		<>
			<menu.Item onSelect={() => actions.onOpen(session)}>
				<SquareArrowOutUpRight /> {t("sidebar.openSession")}
			</menu.Item>
			<menu.Item onSelect={() => actions.onRename(session)}>
				<Pencil /> {t("sidebar.rename")}
			</menu.Item>
			<menu.Sub>
				<menu.SubTrigger>
					<FolderInput /> {t("groups.moveTo")}
				</menu.SubTrigger>
				<menu.SubContent>
					{groups.map((group) => (
						<menu.Item
							key={group.id}
							checked={session.groupId === group.id}
							onSelect={() => actions.onAssign(session, group.id)}
						>
							{group.name}
						</menu.Item>
					))}
					<menu.Item checked={session.groupId === undefined} onSelect={() => actions.onAssign(session, null)}>
						{t("groups.noGroup")}
					</menu.Item>
					<menu.Separator />
					<menu.Item onSelect={() => actions.onNewGroupWith(session)}>
						<Plus /> {t("groups.create")}
					</menu.Item>
				</menu.SubContent>
			</menu.Sub>
			<menu.Item onSelect={() => actions.onClone(session)}>
				<Copy /> {t("sidebar.clone")}
			</menu.Item>
			<menu.Item onSelect={() => actions.onExport(session)}>
				<Download /> {t("sidebar.exportHtml")}
			</menu.Item>
			<menu.Item onSelect={() => actions.onExportJsonl(session)}>
				<FileDown /> {t("sidebar.exportJsonl")}
			</menu.Item>
			{running && (
				<menu.Item onSelect={() => actions.onStop(session)}>
					<Square /> {t("sidebar.closeProcess")}
				</menu.Item>
			)}
			<menu.Separator />
			<menu.Item destructive onSelect={() => actions.onDelete(session)}>
				<Trash /> {t("sidebar.delete")}
			</menu.Item>
		</>
	);
}

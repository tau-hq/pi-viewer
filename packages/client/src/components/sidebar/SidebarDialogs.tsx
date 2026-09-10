import type { SessionSummary } from "@pi-tau/shared";
import { t } from "@/i18n";
import { useGroupsStore } from "@/store/groups-store";
import { useSessionsStore } from "@/store/sessions-store";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";
import { PromptDialog } from "../dialogs/PromptDialog";
import { commandFailure } from "./actions";
import type { SidebarGroup } from "./grouping";

/** The one question the sidebar is currently asking. */
export type SidebarPrompt =
	| { kind: "renameSession"; session: SessionSummary }
	| { kind: "deleteSession"; session: SessionSummary }
	/** A new group; `session` moves into it as soon as the host has created it. */
	| { kind: "newGroup"; session?: SessionSummary }
	| { kind: "deleteGroup"; group: SidebarGroup };

interface SidebarDialogsProps {
	prompt: SidebarPrompt | undefined;
	onClose: () => void;
}

/** Rename, delete, and the two group questions. Each one carries out its own command. */
export function SidebarDialogs({ prompt, onClose }: SidebarDialogsProps) {
	const session = prompt && "session" in prompt ? prompt.session : undefined;
	const groups = useGroupsStore.getState;
	const sessions = useSessionsStore.getState;

	return (
		<>
			<PromptDialog
				open={prompt?.kind === "renameSession"}
				title={t("sidebar.rename")}
				initialValue={session?.name ?? ""}
				placeholder={t("sidebar.renamePrompt")}
				onCancel={onClose}
				onSubmit={(name) => {
					onClose();
					if (session) void sessions().rename(session, name).catch(commandFailure("setName"));
				}}
			/>
			<ConfirmDialog
				open={prompt?.kind === "deleteSession"}
				title={t("confirm.deleteTitle")}
				description={t("confirm.deleteDescription")}
				confirmLabel={t("confirm.delete")}
				destructive
				onCancel={onClose}
				onConfirm={() => {
					onClose();
					if (session) void sessions().remove(session).catch(commandFailure("sessions.delete"));
				}}
			/>
			<PromptDialog
				open={prompt?.kind === "newGroup"}
				title={t("groups.createTitle")}
				placeholder={t("groups.namePlaceholder")}
				submitLabel={t("newSession.create")}
				onCancel={onClose}
				onSubmit={(name) => {
					onClose();
					void (async () => {
						const created = await groups().createGroup(name);
						// The session the menu started from moves into the group it just made.
						if (created && session) await groups().assign(session.path, created.id);
					})();
				}}
			/>
			<ConfirmDialog
				open={prompt?.kind === "deleteGroup"}
				title={t("groups.deleteTitle")}
				description={t("groups.deleteDescription")}
				confirmLabel={t("groups.delete")}
				destructive
				onCancel={onClose}
				onConfirm={() => {
					const groupId = prompt?.kind === "deleteGroup" ? prompt.group.groupId : undefined;
					onClose();
					if (groupId !== undefined) void groups().deleteGroup(groupId);
				}}
			/>
		</>
	);
}

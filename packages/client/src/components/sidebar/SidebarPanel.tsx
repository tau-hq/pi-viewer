import type { SessionSummary } from "@pi-tau/shared";
import { FileUp, PanelLeftClose, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { t } from "@/i18n";
import { useActiveSessionFile, useSessionsStore } from "@/store/sessions-store";
import { toast, useUiStore } from "@/store/ui-store";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";
import { PromptDialog } from "../dialogs/PromptDialog";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Kbd } from "../ui/kbd";
import { ScrollArea } from "../ui/scroll-area";
import { groupSessions } from "./grouping";
import { ProjectGroup } from "./ProjectGroup";
import { SidebarFooter } from "./SidebarFooter";

function TauMark() {
	return (
		<span className="flex size-6 items-center justify-center rounded-md border border-border bg-secondary font-semibold text-foreground text-sm">
			τ
		</span>
	);
}

function failure(command: string) {
	return (error: unknown) => toast("error", t("toast.commandFailed", { command, message: String(error) }));
}

interface SidebarPanelProps {
	/** Docked next to the content, or an overlay drawer that closes after navigation. */
	variant: "docked" | "drawer";
	onClose: () => void;
}

/** Session list with search, grouped by project; shared by the docked sidebar and the drawer. */
export function SidebarPanel({ variant, onClose }: SidebarPanelProps) {
	const openDialog = useUiStore((s) => s.openDialog);
	const sessions = useSessionsStore((s) => s.sessions);
	const projects = useSessionsStore((s) => s.projects);
	const loaded = useSessionsStore((s) => s.loaded);
	const currentSessionId = useSessionsStore((s) => s.currentSessionId);
	const activeSessionFile = useActiveSessionFile();
	const store = useSessionsStore.getState;
	const [query, setQuery] = useState("");
	const [renameTarget, setRenameTarget] = useState<SessionSummary | undefined>(undefined);
	const [deleteTarget, setDeleteTarget] = useState<SessionSummary | undefined>(undefined);

	const groups = useMemo(() => groupSessions(projects, sessions, query.trim()), [projects, sessions, query]);
	const drawer = variant === "drawer";
	const afterNavigate = () => {
		if (drawer) onClose();
	};

	return (
		<>
			<div className="flex h-12 items-center gap-2 px-3">
				<TauMark />
				<span className="flex-1 font-semibold text-sm">{t("app.title")}</span>
				<IconButton
					size="iconSm"
					label={drawer ? t("sidebar.close") : t("sidebar.collapse")}
					icon={drawer ? <X /> : <PanelLeftClose />}
					onClick={onClose}
				/>
			</div>
			<div className="flex flex-col gap-2 px-3 pb-2">
				<div className="flex items-center gap-1">
					<Button
						variant="secondary"
						className="min-w-0 flex-1 justify-start"
						onClick={() => {
							afterNavigate();
							openDialog("newSession");
						}}
					>
						<Plus />
						<span className="flex-1 truncate text-left">{t("sidebar.newSession")}</span>
						{!drawer && <Kbd>Ctrl+⇧+N</Kbd>}
					</Button>
					<IconButton
						size="iconSm"
						variant="secondary"
						data-testid="sidebar-import"
						label={t("sidebar.importSession")}
						icon={<FileUp />}
						onClick={() => {
							afterNavigate();
							openDialog("importSession");
						}}
					/>
				</div>
				<div className="relative">
					<Search className="pointer-events-none absolute top-2 left-2 size-3.5 text-muted-foreground" />
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={t("sidebar.search")}
						className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-7 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
					/>
				</div>
			</div>
			<ScrollArea className="min-h-0 flex-1">
				<div className="px-2 pb-2">
					{groups.map((group) => (
						<ProjectGroup
							key={group.cwd}
							group={group}
							currentSessionId={currentSessionId}
							activeSessionFile={activeSessionFile}
							onOpen={(session) => {
								afterNavigate();
								void store().open(session).catch(failure("sessions.open"));
							}}
							onRename={setRenameTarget}
							onDelete={setDeleteTarget}
							onExport={(session) => void store().exportHtml(session).catch(failure("exportHtml"))}
							onExportJsonl={(session) => void store().exportJsonl(session).catch(failure("sessions.exportJsonl"))}
							onStop={(session) => void store().stop(session).catch(failure("sessions.close"))}
						/>
					))}
					{loaded && groups.length === 0 && (
						<p className="px-2 py-6 text-center text-muted-foreground text-xs">
							{sessions.length === 0 ? t("sidebar.noSessions") : t("sidebar.noMatches")}
						</p>
					)}
				</div>
			</ScrollArea>
			<SidebarFooter />
			<PromptDialog
				open={renameTarget !== undefined}
				title={t("sidebar.rename")}
				initialValue={renameTarget?.name ?? ""}
				placeholder={t("sidebar.renamePrompt")}
				onCancel={() => setRenameTarget(undefined)}
				onSubmit={(name) => {
					const target = renameTarget;
					setRenameTarget(undefined);
					if (target) void store().rename(target, name).catch(failure("setName"));
				}}
			/>
			<ConfirmDialog
				open={deleteTarget !== undefined}
				title={t("confirm.deleteTitle")}
				description={t("confirm.deleteDescription")}
				confirmLabel={t("confirm.delete")}
				destructive
				onCancel={() => setDeleteTarget(undefined)}
				onConfirm={() => {
					const target = deleteTarget;
					setDeleteTarget(undefined);
					if (target) void store().remove(target).catch(failure("sessions.delete"));
				}}
			/>
		</>
	);
}

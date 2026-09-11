import { FileUp, FolderPlus, PanelLeftClose, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { t } from "@/i18n";
import { useConnectionStore } from "@/store/connection-store";
import { useGroupsStore } from "@/store/groups-store";
import { useActiveSessionFile, useSessionsStore } from "@/store/sessions-store";
import { useUiStore } from "@/store/ui-store";
import { Button } from "../ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../ui/context-menu";
import { IconButton } from "../ui/icon-button";
import { Kbd } from "../ui/kbd";
import { ScrollArea } from "../ui/scroll-area";
import { commandFailure, type GroupActions, type SessionActions, type SidebarDrag } from "./actions";
import { dropAssignment } from "./drop-target";
import { GroupSection } from "./GroupSection";
import { buildSidebarGroups } from "./grouping";
import { SidebarDialogs, type SidebarPrompt } from "./SidebarDialogs";
import { SidebarFooter } from "./SidebarFooter";

function TauMark() {
	return (
		<span className="flex size-6 items-center justify-center rounded-md border border-border bg-secondary font-semibold text-foreground text-sm">
			τ
		</span>
	);
}

interface SidebarPanelProps {
	/** Docked next to the content, or an overlay drawer that closes after navigation. */
	variant: "docked" | "drawer";
	onClose: () => void;
}

/**
 * Session list with search: the user's own groups first, then a group per project for every
 * session that is not filed under one. Shared by the docked sidebar and the drawer.
 */
export function SidebarPanel({ variant, onClose }: SidebarPanelProps) {
	const openDialog = useUiStore((s) => s.openDialog);
	const sessions = useSessionsStore((s) => s.sessions);
	const projects = useSessionsStore((s) => s.projects);
	const loaded = useSessionsStore((s) => s.loaded);
	const currentSessionId = useSessionsStore((s) => s.currentSessionId);
	const activeSessionFile = useActiveSessionFile();
	const userGroups = useGroupsStore((s) => s.groups);
	const projectNames = useGroupsStore((s) => s.projectNames);
	const defaultCwd = useConnectionStore((s) => s.host?.defaultCwd ?? "");
	const store = useSessionsStore.getState;
	const groupStore = useGroupsStore.getState;
	const [query, setQuery] = useState("");
	const [prompt, setPrompt] = useState<SidebarPrompt | undefined>(undefined);
	const [dragging, setDragging] = useState<SidebarDrag["dragging"]>(undefined);
	const [dropKey, setDropKey] = useState<string | undefined>(undefined);

	const groups = useMemo(
		() => buildSidebarGroups(userGroups, projectNames, projects, sessions, query.trim()),
		[userGroups, projectNames, projects, sessions, query],
	);
	const drawer = variant === "drawer";
	const afterNavigate = () => {
		if (drawer) onClose();
	};

	const endDrag = () => {
		setDragging(undefined);
		setDropKey(undefined);
	};

	const drag: SidebarDrag = {
		dragging,
		dropKey,
		begin: setDragging,
		end: endDrag,
		over: setDropKey,
		leave: (key) => setDropKey((current) => (current === key ? undefined : current)),
		drop: (target) => {
			endDrag();
			const assignment = dragging && dropAssignment(dragging, target);
			if (assignment) void groupStore().assign(assignment.sessionPath, assignment.groupId);
		},
	};

	const actions: SessionActions = {
		onOpen: (session) => {
			afterNavigate();
			void store().open(session).catch(commandFailure("sessions.open"));
		},
		onRename: (session) => setPrompt({ kind: "renameSession", session }),
		onDelete: (session) => setPrompt({ kind: "deleteSession", session }),
		onExport: (session) => void store().exportHtml(session).catch(commandFailure("exportHtml")),
		onExportJsonl: (session) => void store().exportJsonl(session).catch(commandFailure("sessions.exportJsonl")),
		onStop: (session) => void store().stop(session).catch(commandFailure("sessions.close")),
		onClone: (session) => void store().cloneSession(session).catch(commandFailure("clone")),
		onAssign: (session, groupId) => void groupStore().assign(session.path, groupId),
		onNewGroupWith: (session) => setPrompt({ kind: "newGroup", session }),
	};

	const groupActions: GroupActions = {
		onNewSession: (group) => {
			// A group of its own has no directory, so its first session starts where its others
			// are, and the host's default directory when it is still empty.
			const cwd = group.cwd ?? group.sessions[0]?.cwd ?? defaultCwd;
			if (!cwd) {
				openDialog("newSession");
				return;
			}
			afterNavigate();
			void groupStore().createSessionIn(cwd, group.groupId ?? null);
		},
		onNewGroup: () => setPrompt({ kind: "newGroup" }),
		onRenameGroup: (group, name) => {
			if (group.groupId !== undefined) void groupStore().renameGroup(group.groupId, name);
			else if (group.cwd !== undefined) void groupStore().renameProject(group.cwd, name);
		},
		onResetGroupName: (group) => {
			if (group.cwd !== undefined) void groupStore().renameProject(group.cwd, null);
		},
		onMoveGroup: (group, direction) => {
			if (group.groupId !== undefined) void groupStore().moveGroup(group.groupId, direction);
		},
		onDeleteGroup: (group) => setPrompt({ kind: "deleteGroup", group }),
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
			{/* The whole scroll area is the trigger, so the empty space below the last group answers too. */}
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<ScrollArea data-testid="sidebar-scroll" className="min-h-0 flex-1">
						<div className="px-2 pb-2" data-testid="sidebar-list">
							{groups.map((group) => (
								<GroupSection
									key={group.key}
									group={group}
									currentSessionId={currentSessionId}
									activeSessionFile={activeSessionFile}
									actions={actions}
									groupActions={groupActions}
									drag={drag}
								/>
							))}
							{loaded && groups.length === 0 && (
								<p className="px-2 py-6 text-center text-muted-foreground text-xs">
									{sessions.length === 0 ? t("sidebar.noSessions") : t("sidebar.noMatches")}
								</p>
							)}
						</div>
					</ScrollArea>
				</ContextMenuTrigger>
				<ContextMenuContent data-testid="sidebar-context-menu">
					<ContextMenuItem onSelect={() => openDialog("newSession")}>
						<Plus /> {t("sidebar.newSession")}
					</ContextMenuItem>
					<ContextMenuItem onSelect={() => setPrompt({ kind: "newGroup" })}>
						<FolderPlus /> {t("groups.create")}
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<SidebarFooter />
			<SidebarDialogs prompt={prompt} onClose={() => setPrompt(undefined)} />
		</>
	);
}

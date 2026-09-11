import { ChevronRight } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { isActiveSummary } from "@/lib/session-match";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/ui-store";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "../ui/context-menu";
import type { GroupActions, SessionActions, SidebarDrag } from "./actions";
import { canDrop, type DropTarget } from "./drop-target";
import { GroupMenuItems } from "./GroupMenuItems";
import type { SidebarGroup } from "./grouping";
import { CONTEXT_KIT } from "./menu-kit";
import { SessionItem } from "./SessionItem";

interface GroupSectionProps {
	group: SidebarGroup;
	currentSessionId: string | undefined;
	/** File of the shown session; it wins over the id after a clone or fork. */
	activeSessionFile: string | undefined;
	actions: SessionActions;
	groupActions: GroupActions;
	drag: SidebarDrag;
}

/**
 * One block of the sidebar: a group the user made, or a project directory. Both look the same
 * and take drops; only a user group can be renamed, reordered and deleted.
 */
export function GroupSection({
	group,
	currentSessionId,
	activeSessionFile,
	actions,
	groupActions,
	drag,
}: GroupSectionProps) {
	const collapsed = useUiStore((s) => group.key in s.collapsedGroups);
	const toggleCollapsed = useUiStore((s) => s.toggleGroupCollapsed);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(group.name);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!editing) {
			setDraft(group.name);
			return;
		}
		// A frame later, so the closing menu's focus restore cannot steal the caret.
		const frame = requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
		return () => cancelAnimationFrame(frame);
	}, [editing, group.name]);

	const target: DropTarget =
		group.groupId === undefined ? { kind: "project" } : { kind: "user", groupId: group.groupId };
	const allowed = canDrop(drag.dragging, target);
	const over = allowed && drag.dropKey === group.key;

	const save = () => {
		setEditing(false);
		const name = draft.trim();
		if (name && name !== group.name) groupActions.onRenameGroup(group, name);
	};
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") save();
		else if (event.key === "Escape") {
			event.preventDefault();
			setEditing(false);
			setDraft(group.name);
		}
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: only a drop zone for the pointer; every action here is also in the header menu */}
				<section
					data-testid={group.kind === "user" ? "session-group" : "project-group"}
					data-group-key={group.key}
					data-group-id={group.groupId}
					data-project-cwd={group.cwd}
					data-drop-active={over || undefined}
					onDragOver={(event) => {
						if (!allowed) return;
						// Only a prevented dragover makes the browser offer this element as a drop target.
						event.preventDefault();
						event.dataTransfer.dropEffect = "move";
						if (!over) drag.over(group.key);
					}}
					onDragLeave={(event) => {
						const next = event.relatedTarget;
						if (next instanceof Node && event.currentTarget.contains(next)) return;
						drag.leave(group.key);
					}}
					onDrop={(event) => {
						if (!allowed) return;
						event.preventDefault();
						drag.drop(target);
					}}
					className={cn("mb-1 rounded-md", over && "bg-accent/40 ring-1 ring-ring")}
				>
					{editing ? (
						<input
							ref={inputRef}
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							onBlur={save}
							onKeyDown={onKeyDown}
							data-testid="group-name-input"
							placeholder={t("groups.namePlaceholder")}
							title={t("groups.renameHint")}
							className="mb-0.5 h-6 w-full rounded-md border border-input bg-background px-1.5 font-medium text-[11px] outline-none focus-visible:border-ring"
						/>
					) : (
						<button
							type="button"
							data-testid="group-header"
							onClick={() => toggleCollapsed(group.key)}
							onDoubleClick={() => setEditing(true)}
							title={group.cwd ?? group.name}
							aria-label={collapsed ? t("groups.expand") : t("groups.collapse")}
							className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left font-medium text-[11px] text-muted-foreground uppercase tracking-wide hover:text-foreground"
						>
							<ChevronRight className={cn("size-3 transition-transform", !collapsed && "rotate-90")} />
							<span className="min-w-0 flex-1 truncate">{group.name}</span>
							<span className="text-[10px] tabular-nums">{group.sessions.length}</span>
						</button>
					)}
					{!collapsed && (
						<div className="flex flex-col gap-px">
							{group.sessions.map((session) => (
								<SessionItem
									key={session.path}
									session={session}
									active={isActiveSummary(session, currentSessionId, activeSessionFile)}
									actions={actions}
									drag={drag}
								/>
							))}
							{group.sessions.length === 0 && (
								<p data-testid="group-drop-hint" className="px-2 py-2 text-[11px] text-muted-foreground italic">
									{t("groups.dropHint")}
								</p>
							)}
						</div>
					)}
				</section>
			</ContextMenuTrigger>
			<ContextMenuContent data-testid="group-context-menu">
				<GroupMenuItems
					menu={CONTEXT_KIT}
					group={group}
					actions={groupActions}
					onStartRename={() => setEditing(true)}
				/>
			</ContextMenuContent>
		</ContextMenu>
	);
}

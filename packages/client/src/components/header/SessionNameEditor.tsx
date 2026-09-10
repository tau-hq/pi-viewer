import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { messageText, truncate } from "@/lib/messages";
import { useSessionStore } from "@/store/session-store";
import { useSessionsStore } from "@/store/sessions-store";
import { useUiStore } from "@/store/ui-store";

export function useSessionTitle(sessionId: string): string {
	const stateName = useSessionStore((s) => s.views[sessionId]?.state.sessionName);
	const summaryName = useSessionsStore((s) => s.sessions.find((session) => session.id === sessionId)?.name);
	const firstMessage = useSessionStore((s) => {
		const first = s.views[sessionId]?.messages.find((m) => m.role === "user");
		return first ? messageText(first) : undefined;
	});
	const name = stateName?.trim() || summaryName?.trim();
	if (name) return name;
	const preview = firstMessage?.trim().replace(/\s+/g, " ");
	return preview ? truncate(preview, 60) : t("sidebar.untitled");
}

export function SessionNameEditor({ sessionId }: { sessionId: string }) {
	const title = useSessionTitle(sessionId);
	const command = useSessionsStore((s) => s.command);
	const renameRequested = useUiStore((s) => s.dialog === "rename");
	const closeDialog = useUiStore((s) => s.closeDialog);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(title);
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (!editing) setDraft(title);
		else inputRef.current?.select();
	}, [title, editing]);
	// The /name slash command without arguments opens the inline editor.
	useEffect(() => {
		if (renameRequested) {
			setEditing(true);
			closeDialog();
		}
	}, [renameRequested, closeDialog]);

	const save = () => {
		setEditing(false);
		const name = draft.trim();
		if (name && name !== title) void command({ type: "setName", name }).catch(() => undefined);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") save();
		else if (event.key === "Escape") {
			event.preventDefault();
			setEditing(false);
			setDraft(title);
		}
	};

	if (editing) {
		return (
			<input
				ref={inputRef}
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={save}
				onKeyDown={onKeyDown}
				placeholder={t("header.namePlaceholder")}
				className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-medium text-sm outline-none focus-visible:border-ring"
			/>
		);
	}
	return (
		<button
			type="button"
			onClick={() => setEditing(true)}
			title={t("header.rename")}
			className="min-w-0 max-w-full truncate rounded-md px-1.5 py-0.5 text-left font-medium text-sm hover:bg-accent"
		>
			{title}
		</button>
	);
}

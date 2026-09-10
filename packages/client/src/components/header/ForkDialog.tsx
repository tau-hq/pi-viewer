import type { ForkMessageInfo } from "@pi-tau/shared";
import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { asRecord, pickArray, pickString } from "@/lib/result-data";
import { useSessionsStore } from "@/store/sessions-store";
import { toast, useUiStore } from "@/store/ui-store";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Spinner } from "../ui/spinner";

export function ForkDialog() {
	const open = useUiStore((s) => s.dialog === "fork");
	const closeDialog = useUiStore((s) => s.closeDialog);
	const command = useSessionsStore((s) => s.command);
	const [messages, setMessages] = useState<ForkMessageInfo[] | undefined>(undefined);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!open) return;
		setMessages(undefined);
		setBusy(false);
		let cancelled = false;
		command({ type: "getForkMessages" })
			.then((data) => {
				if (!cancelled) setMessages(pickArray<ForkMessageInfo>(data, "messages"));
			})
			.catch(() => {
				if (!cancelled) setMessages([]);
			});
		return () => {
			cancelled = true;
		};
	}, [open, command]);

	const fork = async (entryId: string) => {
		if (busy) return;
		setBusy(true);
		try {
			// pi keeps the host handle and writes a new session file; the host replaces the
			// transcript and reports the new file through state.update, so only the list needs a refresh.
			const data = await command({ type: "fork", entryId });
			closeDialog();
			const cancelled = asRecord(data)?.cancelled === true;
			toast("info", cancelled ? t("toast.forkCancelled") : t("toast.forked"));
			// pi rewinds to before the picked message and hands its text back for editing.
			const text = pickString(data, "text");
			const sessionId = useSessionsStore.getState().currentSessionId;
			if (!cancelled && text && sessionId) useUiStore.getState().insertIntoComposer(sessionId, text);
			void useSessionsStore.getState().loadSessions();
		} catch {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("fork.title")}</DialogTitle>
					<DialogDescription>{t("fork.description")}</DialogDescription>
				</DialogHeader>
				<div className="max-h-96 overflow-y-auto rounded-md border border-border">
					{messages === undefined && (
						<div className="flex items-center justify-center gap-2 p-6 text-muted-foreground text-sm">
							<Spinner /> {t("fork.loading")}
						</div>
					)}
					{messages?.length === 0 && <p className="p-6 text-center text-muted-foreground text-sm">{t("fork.empty")}</p>}
					{messages?.map((message, index) => (
						<button
							type="button"
							key={message.entryId}
							disabled={busy}
							onClick={() => void fork(message.entryId)}
							className="flex w-full items-start gap-3 border-border border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent disabled:opacity-60"
						>
							<span className="w-6 shrink-0 text-muted-foreground text-xs tabular-nums">{index + 1}</span>
							<span className="line-clamp-2 min-w-0 flex-1">{message.text}</span>
							<span className="shrink-0 text-[11px] text-muted-foreground">
								{new Date(message.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
							</span>
						</button>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}

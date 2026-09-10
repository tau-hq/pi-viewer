import { ListX, X } from "lucide-react";
import { useState } from "react";
import { t } from "@/i18n";
import { useSessionStore } from "@/store/session-store";
import { useSessionsStore } from "@/store/sessions-store";
import { toast } from "@/store/ui-store";
import { Badge } from "../ui/badge";
import { IconButton } from "../ui/icon-button";
import { parseClearedQueue, type QueueEntry, queueEntries, requeueCommands } from "./queue";

const EMPTY: string[] = [];

export function QueuePanel({ sessionId }: { sessionId: string }) {
	const steering = useSessionStore((s) => s.views[sessionId]?.queue.steering ?? EMPTY);
	const followUp = useSessionStore((s) => s.views[sessionId]?.queue.followUp ?? EMPTY);
	const command = useSessionsStore((s) => s.command);
	const commandSilent = useSessionsStore((s) => s.commandSilent);
	// One queue rewrite at a time: a second clear while the rest is being queued again would lose entries.
	const [busy, setBusy] = useState(false);
	if (steering.length === 0 && followUp.length === 0) return null;

	const entries = queueEntries(steering, followUp);

	/** pi only clears the whole queue, so drop it and queue everything but this entry again. */
	const remove = async (entry: QueueEntry) => {
		if (busy) return;
		setBusy(true);
		try {
			const cleared = parseClearedQueue(await commandSilent({ type: "clearQueue" }));
			for (const next of requeueCommands(cleared, entry)) await commandSilent(next);
			toast("info", t("toast.queueEntryRemoved"));
		} catch (error) {
			toast("error", t("toast.commandFailed", { command: "clearQueue", message: String(error) }));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div
			data-testid="queue-panel"
			className="flex items-start gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs"
		>
			<ul className="min-w-0 flex-1 space-y-1">
				{entries.map((entry) => (
					<li key={entry.key} data-testid="queue-entry" className="flex min-w-0 items-center gap-2">
						<Badge variant={entry.kind === "steering" ? "default" : "secondary"}>
							{entry.kind === "steering" ? t("composer.queueSteering") : t("composer.queueFollowUp")}
						</Badge>
						<span className="min-w-0 flex-1 truncate">{entry.text}</span>
						<IconButton
							size="iconSm"
							data-testid="queue-entry-remove"
							label={t("composer.removeQueued")}
							icon={<X />}
							disabled={busy}
							onClick={() => void remove(entry)}
						/>
					</li>
				))}
			</ul>
			<IconButton
				size="iconSm"
				data-testid="queue-clear"
				label={t("composer.clearQueue")}
				icon={<ListX />}
				disabled={busy}
				onClick={() =>
					void command({ type: "clearQueue" })
						.then(() => toast("info", t("toast.queueCleared")))
						.catch(() => undefined)
				}
			/>
		</div>
	);
}

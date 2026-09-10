import { MessageSquarePlus, Plus } from "lucide-react";
import { t } from "@/i18n";
import { useConnectionStore } from "@/store/connection-store";
import { useSessionsStore } from "@/store/sessions-store";
import { useUiStore } from "@/store/ui-store";
import { DrawerButton } from "./sidebar/Sidebar";
import { TerminalDock } from "./terminal/TerminalDock";
import { Button } from "./ui/button";
import { Kbd } from "./ui/kbd";

export function EmptyState() {
	const loaded = useSessionsStore((s) => s.loaded);
	const count = useSessionsStore((s) => s.sessions.length);
	const openDialog = useUiStore((s) => s.openDialog);
	const defaultCwd = useConnectionStore((s) => s.host?.defaultCwd);
	const none = loaded && count === 0;
	return (
		<>
			<div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
				<DrawerButton className="absolute top-2 left-2 md:hidden" />
				<div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
					<MessageSquarePlus className="size-6" />
				</div>
				<div className="space-y-1">
					<h2 className="font-semibold text-base">{none ? t("empty.noSessions") : t("empty.noSession")}</h2>
					<p className="text-muted-foreground text-sm">{none ? t("empty.noSessionsHint") : t("empty.noSessionHint")}</p>
				</div>
				<Button onClick={() => openDialog("newSession")}>
					<Plus />
					{t("sidebar.newSession")}
					<Kbd className="ml-1 bg-primary-foreground/15 text-primary-foreground/80">Ctrl+Shift+N</Kbd>
				</Button>
			</div>
			{/* Terminals belong to the host, not to a session, so the panel also survives here. */}
			<TerminalDock cwd={defaultCwd ?? "."} />
		</>
	);
}

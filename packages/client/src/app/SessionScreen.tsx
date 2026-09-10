import { useEffect } from "react";
import { Composer } from "@/components/composer/Composer";
import { QueuePanel } from "@/components/composer/QueuePanel";
import { TrustBanner } from "@/components/composer/TrustBanner";
import { WidgetBlocks } from "@/components/composer/WidgetBlocks";
import { CommandsDialog } from "@/components/dialogs/CommandsDialog";
import { SessionSettingsDialog } from "@/components/dialogs/SessionSettingsDialog";
import { ToolsDialog } from "@/components/dialogs/ToolsDialog";
import { TreeDialog } from "@/components/dialogs/TreeDialog";
import { UiRequestDialog } from "@/components/dialogs/UiRequestDialog";
import { CompactDialog } from "@/components/header/CompactDialog";
import { ForkDialog } from "@/components/header/ForkDialog";
import { SessionHeader } from "@/components/header/SessionHeader";
import { useSessionTitle } from "@/components/header/SessionNameEditor";
import { StatusBar } from "@/components/statusbar/StatusBar";
import { TerminalDock } from "@/components/terminal/TerminalDock";
import { Transcript } from "@/components/transcript/Transcript";
import { Spinner } from "@/components/ui/spinner";
import { t } from "@/i18n";
import { useConnectionStore } from "@/store/connection-store";
import { useSessionStore } from "@/store/session-store";

function DocumentTitle({ sessionId }: { sessionId: string }) {
	const title = useSessionTitle(sessionId);
	const extensionTitle = useSessionStore((s) => s.views[sessionId]?.title);
	useEffect(() => {
		document.title = `${extensionTitle ?? title} · ${t("app.title")}`;
		return () => {
			document.title = t("app.title");
		};
	}, [title, extensionTitle]);
	return null;
}

export function SessionScreen({ sessionId }: { sessionId: string }) {
	const loaded = useSessionStore((s) => s.views[sessionId]?.loaded ?? false);
	const pendingUi = useSessionStore((s) => s.views[sessionId]?.pendingUi[0]);
	const sessionCwd = useSessionStore((s) => s.views[sessionId]?.state.cwd);
	const defaultCwd = useConnectionStore((s) => s.host?.defaultCwd);

	return (
		<>
			<DocumentTitle sessionId={sessionId} />
			<SessionHeader sessionId={sessionId} />
			{loaded ? (
				<Transcript sessionId={sessionId} />
			) : (
				<div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground text-sm">
					<Spinner /> {t("empty.loading")}
				</div>
			)}
			<TerminalDock cwd={sessionCwd || defaultCwd || "."} />
			<div className="shrink-0 border-border border-t bg-background">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pt-2 pb-2">
					<TrustBanner sessionId={sessionId} />
					<WidgetBlocks sessionId={sessionId} placement="aboveEditor" />
					<QueuePanel sessionId={sessionId} />
					<Composer sessionId={sessionId} />
					<WidgetBlocks sessionId={sessionId} placement="belowEditor" />
				</div>
			</div>
			<StatusBar sessionId={sessionId} />
			{pendingUi && <UiRequestDialog key={pendingUi.id} request={pendingUi} />}
			<ForkDialog />
			<CompactDialog />
			<ToolsDialog />
			<TreeDialog />
			<CommandsDialog />
			<SessionSettingsDialog sessionId={sessionId} />
		</>
	);
}

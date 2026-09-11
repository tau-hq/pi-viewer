import { Download, FolderOpen, GitBranch, GitFork, Layers, RotateCw, SquareTerminal, Wrench } from "lucide-react";
import { t } from "@/i18n";
import { shortenPath } from "@/lib/format";
import { useConnectionStore } from "@/store/connection-store";
import { useSessionStore } from "@/store/session-store";
import { exportSessionHtml, useSessionsStore } from "@/store/sessions-store";
import { useTerminalStore } from "@/store/terminal-store";
import { useUiStore } from "@/store/ui-store";
import { DrawerButton } from "../sidebar/Sidebar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Kbd } from "../ui/kbd";
import { Separator } from "../ui/separator";
import { Spinner } from "../ui/spinner";
import { HeaderMenu } from "./HeaderMenu";
import { SearchBox } from "./SearchBox";
import { SessionNameEditor } from "./SessionNameEditor";
import { StatsPopover } from "./StatsPopover";

export function SessionHeader({ sessionId }: { sessionId: string }) {
	const cwd = useSessionStore((s) => s.views[sessionId]?.state.cwd ?? "");
	const alive = useSessionStore((s) => s.views[sessionId]?.state.processAlive ?? false);
	const attaching = useSessionStore((s) => s.views[sessionId]?.attaching ?? false);
	const home = useConnectionStore((s) => s.host?.homeCwd);
	const openDialog = useUiStore((s) => s.openDialog);
	const summary = useSessionsStore((s) => s.sessions.find((session) => session.id === sessionId));
	const reopen = useSessionsStore((s) => s.open);
	const terminalOpen = useTerminalStore((s) => s.open);
	const toggleTerminal = useTerminalStore((s) => s.toggle);

	return (
		<header className="flex h-12 shrink-0 items-center gap-1 border-border border-b px-2 md:gap-2 md:px-3">
			<DrawerButton />
			<div className="flex min-w-0 flex-1 items-center gap-2">
				<SessionNameEditor sessionId={sessionId} />
				{cwd && (
					<Badge variant="outline" className="hidden max-w-64 font-mono md:inline-flex" title={cwd}>
						<FolderOpen />
						<span className="truncate">{shortenPath(cwd, home)}</span>
					</Badge>
				)}
				{attaching && (
					<span className="flex items-center gap-1.5 text-muted-foreground text-xs max-md:hidden">
						<Spinner className="size-3" />
						{t("header.attaching")}
					</span>
				)}
				{!alive && !attaching && (
					<>
						<Badge variant="warning" className="max-md:hidden">
							{t("header.processDead")}
						</Badge>
						{summary && (
							<Button size="sm" variant="outline" onClick={() => void reopen(summary).catch(() => undefined)}>
								<RotateCw />
								{t("header.restart")}
							</Button>
						)}
					</>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-0.5">
				<SearchBox key={sessionId} sessionId={sessionId} />
				<IconButton
					label={t("header.terminal")}
					icon={<SquareTerminal />}
					data-testid="header-terminal"
					aria-pressed={terminalOpen}
					variant={terminalOpen ? "secondary" : "ghost"}
					onClick={toggleTerminal}
					hint={<Kbd>Ctrl+`</Kbd>}
				/>
				<Separator orientation="vertical" className="mx-1 h-5 max-md:hidden" />
				<div className="hidden items-center gap-0.5 md:flex">
					<IconButton
						label={t("header.tools")}
						icon={<Wrench />}
						disabled={!alive}
						onClick={() => openDialog("tools")}
					/>
					<IconButton
						label={t("header.tree")}
						icon={<GitBranch />}
						disabled={!alive}
						onClick={() => openDialog("tree")}
					/>
					<IconButton
						label={t("header.fork")}
						icon={<GitFork />}
						disabled={!alive}
						onClick={() => openDialog("fork")}
					/>
					<IconButton
						label={t("header.compact")}
						icon={<Layers />}
						disabled={!alive}
						onClick={() => openDialog("compact")}
					/>
					<IconButton
						label={t("header.export")}
						icon={<Download />}
						disabled={!alive}
						onClick={() => void exportSessionHtml(sessionId).catch(() => undefined)}
					/>
				</div>
				<StatsPopover sessionId={sessionId} />
				<HeaderMenu sessionId={sessionId} alive={alive} />
			</div>
		</header>
	);
}

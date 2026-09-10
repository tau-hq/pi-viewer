import type { BashExecutionMessage } from "@pi-tau/shared";
import { Terminal } from "lucide-react";
import { t } from "@/i18n";
import type { BashRun } from "@/store/session-reducer";
import { useSessionStore } from "@/store/session-store";
import { Badge } from "../ui/badge";
import { Spinner } from "../ui/spinner";
import { useExpanded } from "./expanded";
import { PreviewText } from "./ToolResultBody";

function Frame({ children }: { children: React.ReactNode }) {
	return <div className="my-1.5 overflow-hidden rounded-lg border border-bash/40 bg-card">{children}</div>;
}

function Header({ command, children }: { command: string | undefined; children?: React.ReactNode }) {
	return (
		<div className="flex items-center gap-2 border-border border-b px-3 py-1.5 text-xs">
			<Terminal className="size-3.5 shrink-0 text-bash" />
			<code className="min-w-0 flex-1 truncate font-mono">
				<span className="text-bash">$ </span>
				{command ?? ""}
			</code>
			{children}
		</div>
	);
}

interface StatusBadgesProps {
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
	excludeFromContext?: boolean | undefined;
}

function StatusBadges({ exitCode, cancelled, truncated, excludeFromContext }: StatusBadgesProps) {
	const failed = exitCode !== undefined && exitCode !== 0;
	return (
		<>
			{cancelled && <Badge variant="warning">{t("transcript.cancelled")}</Badge>}
			{truncated && <Badge variant="outline">{t("transcript.truncated")}</Badge>}
			{excludeFromContext && <Badge variant="outline">{t("transcript.excluded")}</Badge>}
			{exitCode !== undefined && (
				<Badge variant={failed ? "destructive" : "success"}>{t("transcript.exitCode", { code: exitCode })}</Badge>
			)}
		</>
	);
}

export function BashExecutionCard({ message }: { message: BashExecutionMessage }) {
	const [open, toggle] = useExpanded(`bash:${message.id}`, false);
	return (
		<Frame>
			<Header command={message.command}>
				<StatusBadges
					exitCode={message.exitCode}
					cancelled={message.cancelled}
					truncated={message.truncated}
					excludeFromContext={message.excludeFromContext}
				/>
			</Header>
			<PreviewText text={message.output} open={open} onToggle={() => toggle()} />
		</Frame>
	);
}

/** A `!` run of this client: streaming output, then the exit state until the host's message replaces it. */
function LiveBashCard({ run }: { run: BashRun }) {
	const [open, toggle] = useExpanded(`bash-live:${run.commandId}`, false);
	const result = run.result;
	return (
		<Frame>
			<Header command={run.command}>
				{result ? (
					<StatusBadges exitCode={result.exitCode} cancelled={result.cancelled} truncated={result.truncated} />
				) : (
					<Spinner className="size-3.5 text-bash" />
				)}
			</Header>
			<PreviewText text={run.output} open={open} onToggle={() => toggle()} tail={!result} />
		</Frame>
	);
}

export function LiveBashRow({ sessionId }: { sessionId: string }) {
	const run = useSessionStore((s) => s.views[sessionId]?.bashRun);
	return run ? <LiveBashCard run={run} /> : null;
}

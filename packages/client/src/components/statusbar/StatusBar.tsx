import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { stripAnsi } from "@/lib/ansi";
import { formatCost, formatPercent, formatTokens } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/store/session-store";
import { useSessionsStore } from "@/store/sessions-store";
import { APPROVAL_MODE_TEXT } from "../composer/approval-modes";
import { thinkingLabel } from "../composer/ThinkingPicker";
import { contextColor } from "../header/StatsPopover";
import { Spinner } from "../ui/spinner";

const EMPTY: Record<string, string> = {};

function Item({
	children,
	className,
	title,
}: {
	children: React.ReactNode;
	className?: string;
	title?: string | undefined;
}) {
	return (
		<span title={title} className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap", className)}>
			{children}
		</span>
	);
}

function RetryIndicator({ sessionId }: { sessionId: string }) {
	const retry = useSessionStore((s) => s.views[sessionId]?.retry);
	const command = useSessionsStore((s) => s.command);
	const [seconds, setSeconds] = useState(0);
	useEffect(() => {
		if (!retry) return;
		const deadline = Date.now() + retry.delayMs;
		const tick = () => setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
		tick();
		const timer = setInterval(tick, 500);
		return () => clearInterval(timer);
	}, [retry]);
	if (!retry) return null;
	return (
		<Item className="text-warning" title={retry.errorMessage}>
			<Spinner className="size-3 text-warning" />
			{t("status.retry", { attempt: retry.attempt, max: retry.maxAttempts, seconds })}
			<button
				type="button"
				onClick={() => void command({ type: "abortRetry" }).catch(() => undefined)}
				className="rounded px-1 underline-offset-2 hover:underline"
			>
				{t("status.abortRetry")}
			</button>
		</Item>
	);
}

export function StatusBar({ sessionId }: { sessionId: string }) {
	const model = useSessionStore((s) => s.views[sessionId]?.state.model);
	const thinkingLevel = useSessionStore((s) => s.views[sessionId]?.state.thinkingLevel);
	const approvalMode = useSessionStore((s) => s.views[sessionId]?.state.approvalMode);
	const isStreaming = useSessionStore((s) => s.views[sessionId]?.state.isStreaming ?? false);
	const isCompacting = useSessionStore((s) => s.views[sessionId]?.state.isCompacting ?? false);
	const alive = useSessionStore((s) => s.views[sessionId]?.state.processAlive ?? true);
	const stats = useSessionStore((s) => s.views[sessionId]?.stats);
	const statuses = useSessionStore((s) => s.views[sessionId]?.statuses ?? EMPTY);
	const command = useSessionsStore((s) => s.command);

	const percent = stats?.contextUsage?.percent ?? null;
	const statusEntries = Object.entries(statuses).sort(([a], [b]) => a.localeCompare(b));

	return (
		<footer className="flex h-7 shrink-0 items-center gap-3 overflow-hidden border-border border-t bg-card/40 px-3 text-[11px] text-muted-foreground">
			<Item className="font-mono" title={model ? `${model.provider} · ${model.id}` : undefined}>
				{model ? model.id : t("status.noModel")}
			</Item>
			{model?.reasoning && thinkingLevel && <Item>{thinkingLabel(thinkingLevel)}</Item>}
			{approvalMode && (
				<Item title={t("mode.title")}>
					<span data-testid="status-mode">{t(APPROVAL_MODE_TEXT[approvalMode].title)}</span>
				</Item>
			)}
			{stats && (
				<>
					<Item className={cn("font-mono tabular-nums", contextColor(percent))} title={t("status.context")}>
						{formatPercent(percent)}
						{stats.contextUsage ? `/${formatTokens(stats.contextUsage.contextWindow)}` : ""}
					</Item>
					<Item className="font-mono tabular-nums">
						{t("status.tokens", { input: formatTokens(stats.tokens.input), output: formatTokens(stats.tokens.output) })}
					</Item>
					<Item className="font-mono tabular-nums" title={t("status.cost")}>
						{formatCost(stats.cost)}
					</Item>
				</>
			)}
			<span className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
				{statusEntries.map(([key, text]) => (
					<Item key={key} title={key} className="truncate font-mono">
						{stripAnsi(text)}
					</Item>
				))}
			</span>
			{!alive && <Item className="text-warning">{t("status.processDead")}</Item>}
			<RetryIndicator sessionId={sessionId} />
			{isCompacting && (
				<Item className="text-primary">
					<Spinner className="size-3 text-primary" />
					{t("status.compacting")}
				</Item>
			)}
			{isStreaming && (
				<Item className="text-primary">
					<Spinner className="size-3 text-primary" />
					{t("status.streaming")}
					<button
						type="button"
						onClick={() => void command({ type: "abort" }).catch(() => undefined)}
						className="rounded px-1 underline-offset-2 hover:underline"
					>
						{t("status.abort")}
					</button>
				</Item>
			)}
		</footer>
	);
}

import type { SessionStats } from "@pi-tau/shared";
import { ChartBar } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { formatCost, formatPercent, formatTokens } from "@/lib/format";
import { asRecord } from "@/lib/result-data";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/store/session-store";
import { useSessionsStore } from "@/store/sessions-store";
import { IconButton } from "../ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-4 py-0.5">
			<span className="text-muted-foreground">{label}</span>
			<span className="font-mono tabular-nums">{value}</span>
		</div>
	);
}

export function contextColor(percent: number | null | undefined): string {
	if (percent === null || percent === undefined) return "text-muted-foreground";
	if (percent > 90) return "text-destructive";
	if (percent > 70) return "text-warning";
	return "text-muted-foreground";
}

export function StatsPopover({ sessionId }: { sessionId: string }) {
	const cached = useSessionStore((s) => s.views[sessionId]?.stats);
	const command = useSessionsStore((s) => s.command);
	const [open, setOpen] = useState(false);
	const [fresh, setFresh] = useState<SessionStats | undefined>(undefined);
	const stats = fresh ?? cached;

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		command({ type: "getStats" })
			.then((data) => {
				const record = asRecord(data);
				if (!cancelled && record && "tokens" in record) setFresh(record as unknown as SessionStats);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [open, command]);

	const percent = stats?.contextUsage?.percent ?? null;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<span>
					<IconButton label={t("header.stats")} icon={<ChartBar />} />
				</span>
			</PopoverTrigger>
			<PopoverContent className="w-80 text-sm">
				<h3 className="mb-2 font-semibold">{t("stats.title")}</h3>
				{!stats ? (
					<p className="text-muted-foreground text-xs">{t("stats.unavailable")}</p>
				) : (
					<Tabs defaultValue="tokens">
						<TabsList>
							<TabsTrigger value="tokens">{t("stats.tokens")}</TabsTrigger>
							<TabsTrigger value="messages">{t("stats.messages")}</TabsTrigger>
						</TabsList>
						<TabsContent value="tokens" className="text-xs">
							<Row label={t("stats.input")} value={formatTokens(stats.tokens.input)} />
							<Row label={t("stats.output")} value={formatTokens(stats.tokens.output)} />
							<Row label={t("stats.cacheRead")} value={formatTokens(stats.tokens.cacheRead)} />
							<Row label={t("stats.cacheWrite")} value={formatTokens(stats.tokens.cacheWrite)} />
							<Row label={t("stats.total")} value={formatTokens(stats.tokens.total)} />
							<Row label={t("stats.cost")} value={formatCost(stats.cost)} />
							{stats.contextUsage && (
								<div className="mt-2">
									<div className="flex items-center justify-between">
										<span className="text-muted-foreground">{t("stats.context")}</span>
										<span className={cn("font-mono tabular-nums", contextColor(percent))}>
											{formatPercent(percent)} · {formatTokens(stats.contextUsage.tokens ?? 0)} /{" "}
											{formatTokens(stats.contextUsage.contextWindow)}
										</span>
									</div>
									<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
										<div
											className={cn(
												"h-full rounded-full",
												percent !== null && percent > 90
													? "bg-destructive"
													: percent !== null && percent > 70
														? "bg-warning"
														: "bg-primary",
											)}
											style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }}
										/>
									</div>
								</div>
							)}
						</TabsContent>
						<TabsContent value="messages" className="text-xs">
							<Row label={t("stats.user")} value={String(stats.userMessages)} />
							<Row label={t("stats.assistant")} value={String(stats.assistantMessages)} />
							<Row label={t("stats.toolCalls")} value={String(stats.toolCalls)} />
							<Row label={t("stats.toolResults")} value={String(stats.toolResults)} />
							<Row label={t("stats.total")} value={String(stats.totalMessages)} />
						</TabsContent>
					</Tabs>
				)}
			</PopoverContent>
		</Popover>
	);
}

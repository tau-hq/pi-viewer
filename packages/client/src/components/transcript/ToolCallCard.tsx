import type { ToolCallBlock, ToolResultMessage } from "@pi-tau/shared";
import {
	Check,
	ChevronRight,
	CircleAlert,
	FileText,
	FolderOpen,
	Globe,
	type LucideIcon,
	Pencil,
	Search,
	Terminal,
	Wrench,
} from "lucide-react";
import { t } from "@/i18n";
import { toolArgSummary, toolArgs } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { useToolResult, useToolRun } from "@/store/session-store";
import { PulsingDots, Spinner } from "../ui/spinner";
import { useExpanded } from "./expanded";
import { ToolResultBody, ToolRunBody } from "./ToolResultBody";

const TOOL_ICONS: Record<string, LucideIcon> = {
	read: FileText,
	write: Pencil,
	edit: Pencil,
	bash: Terminal,
	grep: Search,
	find: Search,
	glob: Search,
	ls: FolderOpen,
	fetch: Globe,
	web_search: Globe,
	websearch: Globe,
};

type Status = "streaming" | "running" | "done" | "error" | "waiting";

function StatusIcon({ status }: { status: Status }) {
	switch (status) {
		case "running":
			return <Spinner className="size-3.5 text-primary" />;
		case "streaming":
			return <PulsingDots className="text-primary" />;
		case "done":
			return <Check className="size-3.5 text-success" />;
		case "error":
			return <CircleAlert className="size-3.5 text-destructive" />;
		case "waiting":
			return <span className="size-3.5 rounded-full border border-border" />;
	}
}

interface ToolCallCardProps {
	sessionId: string;
	block: ToolCallBlock;
	/** True while the owning assistant message is still streaming. */
	streaming: boolean;
}

/** Compact card for a tool call; the result (or live partial output) is looked up by toolCallId. */
export function ToolCallCard({ sessionId, block, streaming }: ToolCallCardProps) {
	const result = useToolResult(sessionId, block.id);
	const run = useToolRun(sessionId, block.id);
	const [open, toggle] = useExpanded(`tool:${block.id}`, false);
	const summary = toolArgSummary(toolArgs(block.arguments, block.partialJson));
	const status: Status = result
		? result.isError
			? "error"
			: "done"
		: run
			? "running"
			: streaming
				? "streaming"
				: "waiting";
	const Icon = TOOL_ICONS[block.name] ?? Wrench;

	return (
		<div
			className={cn(
				"my-1.5 overflow-hidden rounded-lg border bg-card",
				status === "error" ? "border-destructive/40" : "border-border",
			)}
		>
			<button
				type="button"
				onClick={() => toggle()}
				aria-expanded={open}
				className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/40"
			>
				<span className="flex w-4 shrink-0 items-center justify-center">
					<StatusIcon status={status} />
				</span>
				<Icon className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="shrink-0 font-medium">{block.name || t("transcript.toolResult")}</span>
				<span className="min-w-0 flex-1 truncate font-mono text-muted-foreground" title={summary}>
					{summary}
				</span>
				{status === "waiting" && <span className="shrink-0 text-muted-foreground">{t("transcript.waiting")}</span>}
				<ChevronRight
					className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
				/>
			</button>
			{result ? (
				<ToolResultBody result={result} open={open} onToggle={() => toggle()} />
			) : run ? (
				<ToolRunBody run={run} open={open} onToggle={() => toggle()} />
			) : null}
		</div>
	);
}

/** A tool result whose call is not part of any assistant message in the transcript. */
export function ToolResultCard({ result }: { result: ToolResultMessage }) {
	const [open, toggle] = useExpanded(`tool:${result.toolCallId}`, false);
	const Icon = TOOL_ICONS[result.toolName] ?? Wrench;
	return (
		<div
			className={cn(
				"my-1.5 overflow-hidden rounded-lg border bg-card",
				result.isError ? "border-destructive/40" : "border-border",
			)}
		>
			<div className="flex items-center gap-2 px-3 py-1.5 text-xs">
				<StatusIcon status={result.isError ? "error" : "done"} />
				<Icon className="size-3.5 text-muted-foreground" />
				<span className="font-medium">{result.toolName}</span>
				<span className="text-muted-foreground">· {t("transcript.toolResult")}</span>
			</div>
			<ToolResultBody result={result} open={open} onToggle={() => toggle()} />
		</div>
	);
}

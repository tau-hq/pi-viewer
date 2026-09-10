import type { BranchSummaryMessage, CompactionSummaryMessage, CustomMessage } from "@pi-tau/shared";
import { ChevronRight, GitFork, Layers } from "lucide-react";
import { useMemo } from "react";
import { t } from "@/i18n";
import { formatTokens } from "@/lib/format";
import { imageDataUrl } from "@/lib/images";
import { cn } from "@/lib/utils";
import { Badge } from "../ui/badge";
import { useExpanded } from "./expanded";
import { Markdown } from "./Markdown";

export function SummaryCard({ message }: { message: CompactionSummaryMessage | BranchSummaryMessage }) {
	const [open, toggle] = useExpanded(`summary:${message.id}`, false);
	const compaction = message.role === "compactionSummary";
	return (
		<div className="my-2">
			<div className="flex items-center gap-3 text-muted-foreground text-xs">
				<span className="h-px flex-1 bg-border" />
				<button
					type="button"
					onClick={() => toggle()}
					aria-expanded={open}
					className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 hover:text-foreground"
				>
					{compaction ? <Layers className="size-3.5" /> : <GitFork className="size-3.5" />}
					<span>{compaction ? t("transcript.compaction") : t("transcript.branchSummary")}</span>
					{compaction && (
						<span className="opacity-70">
							· {t("transcript.compactionTokens", { tokens: formatTokens(message.tokensBefore) })}
						</span>
					)}
					<ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
				</button>
				<span className="h-px flex-1 bg-border" />
			</div>
			{open && (
				<div className="mt-2 rounded-lg border border-border bg-card px-4 py-3 text-muted-foreground">
					<Markdown text={message.summary} className="text-[13px]" />
				</div>
			)}
		</div>
	);
}

export function CustomMessageCard({ message }: { message: CustomMessage }) {
	const content = message.content;
	const blocks = useMemo(
		() =>
			typeof content === "string" ? [] : content.map((block, index) => ({ key: `${message.id}:${index}`, block })),
		[content, message.id],
	);
	return (
		<div className="my-1.5 rounded-lg border border-border bg-card px-4 py-2.5">
			<Badge variant="outline" className="mb-1.5">
				{message.customType}
			</Badge>
			{typeof content === "string" ? (
				<Markdown text={content} />
			) : (
				<div className="space-y-2">
					{blocks.map(({ key, block }) =>
						block.type === "text" ? (
							<Markdown key={key} text={block.text} />
						) : (
							<img key={key} src={imageDataUrl(block)} alt={t("transcript.image")} className="max-h-72 rounded-md" />
						),
					)}
				</div>
			)}
		</div>
	);
}

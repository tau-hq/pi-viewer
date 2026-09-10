import { ChevronRight, Sparkles } from "lucide-react";
import { t } from "@/i18n";
import { truncate } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { PulsingDots } from "../ui/spinner";
import { useExpanded } from "./expanded";
import { Markdown } from "./Markdown";

interface ThinkingBlockProps {
	text: string;
	streaming: boolean;
	storageKey: string;
}

export function ThinkingBlock({ text, streaming, storageKey }: ThinkingBlockProps) {
	const [open, toggle] = useExpanded(storageKey, false);
	const preview = text.trim().split("\n")[0] ?? "";
	return (
		<div className="my-1.5 rounded-lg border border-border/70 bg-card/60">
			<button
				type="button"
				onClick={() => toggle()}
				aria-expanded={open}
				className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-muted-foreground text-xs hover:text-foreground"
			>
				<ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
				<Sparkles className="size-3.5 shrink-0" />
				<span className="shrink-0 font-medium">
					{streaming ? t("transcript.thinkingStreaming") : t("transcript.thinking")}
				</span>
				{streaming && <PulsingDots className="text-primary" />}
				{!open && !streaming && preview && (
					<span className="min-w-0 flex-1 truncate opacity-70">{truncate(preview, 160)}</span>
				)}
			</button>
			{open && (
				<div className="px-3 pb-3 text-muted-foreground">
					<Markdown text={text} streaming={streaming} className="text-[13px]" />
				</div>
			)}
		</div>
	);
}

import type { ToolResultMessage, ToolRun } from "@pi-tau/shared";
import { useMemo } from "react";
import { t } from "@/i18n";
import { imageDataUrl } from "@/lib/images";
import { imageBlocks, previewLines, toolResultText } from "@/lib/messages";
import { asRecord } from "@/lib/result-data";
import { cn } from "@/lib/utils";

const PREVIEW_LINES = 12;

interface PreviewTextProps {
	text: string;
	open: boolean;
	onToggle: () => void;
	className?: string;
	/** Show the last lines instead of the first ones (live output). */
	tail?: boolean;
}

export function PreviewText({ text, open, onToggle, className, tail }: PreviewTextProps) {
	const preview = useMemo(() => {
		if (!tail) return previewLines(text, PREVIEW_LINES);
		const lines = text.replace(/\s+$/, "").split("\n");
		return lines.length <= PREVIEW_LINES
			? { lines, hiddenCount: 0 }
			: { lines: lines.slice(-PREVIEW_LINES), hiddenCount: lines.length - PREVIEW_LINES };
	}, [text, tail]);
	if (!text.trim()) return null;
	const shown = open ? text.replace(/\s+$/, "") : preview.lines.join("\n");
	return (
		<div className={cn("text-xs", className)}>
			<pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono leading-relaxed">
				{tail && !open && preview.hiddenCount > 0 ? `…\n${shown}` : shown}
			</pre>
			{preview.hiddenCount > 0 && (
				<button type="button" onClick={onToggle} className="px-3 pb-2 text-[11px] text-primary hover:underline">
					{open ? t("transcript.showLess") : t("transcript.showMore", { count: preview.hiddenCount })}
				</button>
			)}
		</div>
	);
}

function DiffView({ diff, open, onToggle }: { diff: string; open: boolean; onToggle: () => void }) {
	const lines = useMemo(() => diff.replace(/\s+$/, "").split("\n"), [diff]);
	const visible = open ? lines : lines.slice(0, PREVIEW_LINES);
	const hidden = lines.length - visible.length;
	return (
		<div className="border-border border-t text-xs">
			<pre className="max-h-[60vh] overflow-auto px-3 py-2 font-mono leading-relaxed">
				{visible.map((line, index) => (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no identity and the list is static
						key={index}
						className={cn(
							"block whitespace-pre-wrap break-words",
							line.startsWith("+") && !line.startsWith("+++") && "bg-success/10 text-success",
							line.startsWith("-") && !line.startsWith("---") && "bg-destructive/10 text-destructive",
							line.startsWith("@@") && "text-muted-foreground",
						)}
					>
						{line}
					</span>
				))}
			</pre>
			{hidden > 0 && (
				<button type="button" onClick={onToggle} className="px-3 pb-2 text-[11px] text-primary hover:underline">
					{t("transcript.showMore", { count: hidden })}
				</button>
			)}
			{open && lines.length > PREVIEW_LINES && (
				<button type="button" onClick={onToggle} className="px-3 pb-2 text-[11px] text-primary hover:underline">
					{t("transcript.showLess")}
				</button>
			)}
		</div>
	);
}

/** Text of a cumulative partial tool result (string or pi-style {content:[...]} object). */
function partialText(partial: unknown): string {
	if (typeof partial === "string") return partial;
	const record = asRecord(partial);
	const content = record?.content;
	if (Array.isArray(content)) {
		return content
			.map((block) => {
				const b = asRecord(block);
				return b && b.type === "text" && typeof b.text === "string" ? b.text : "";
			})
			.join("\n");
	}
	if (record && typeof record.output === "string") return record.output;
	return "";
}

interface ToolResultBodyProps {
	result: ToolResultMessage;
	open: boolean;
	onToggle: () => void;
}

export function ToolResultBody({ result, open, onToggle }: ToolResultBodyProps) {
	const text = toolResultText(result);
	const images = useMemo(
		() => imageBlocks(result.content).map((image, index) => ({ key: `${result.id}-${index}`, image })),
		[result],
	);
	const diff = asRecord(result.details)?.diff;
	return (
		<div className={cn("border-border border-t", result.isError && "text-destructive")}>
			<PreviewText text={text} open={open} onToggle={onToggle} />
			{typeof diff === "string" && diff.trim() && <DiffView diff={diff} open={open} onToggle={onToggle} />}
			{images.length > 0 && (
				<div className="flex flex-wrap gap-2 px-3 pb-2">
					{images.map(({ key, image }) => (
						<img key={key} src={imageDataUrl(image)} alt={t("transcript.image")} className="max-h-48 rounded-md" />
					))}
				</div>
			)}
		</div>
	);
}

export function ToolRunBody({ run, open, onToggle }: { run: ToolRun; open: boolean; onToggle: () => void }) {
	const text = partialText(run.partial);
	if (!text.trim()) return null;
	return (
		<div className="border-border border-t">
			<div className="px-3 pt-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
				{t("transcript.liveOutput")}
			</div>
			<PreviewText text={text} open={open} onToggle={onToggle} tail />
		</div>
	);
}

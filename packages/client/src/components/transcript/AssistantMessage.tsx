import type { AssistantMessage as AssistantMessageType, ContentBlock } from "@pi-tau/shared";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { memo } from "react";
import { t } from "@/i18n";
import { imageDataUrl } from "@/lib/images";
import { useSessionStore } from "@/store/session-store";
import { PulsingDots } from "../ui/spinner";
import { Markdown } from "./Markdown";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallCard } from "./ToolCallCard";

interface BlockViewProps {
	sessionId: string;
	messageId: string;
	index: number;
	block: ContentBlock;
	/** True only for the block currently receiving deltas. */
	streaming: boolean;
}

const ContentBlockView = memo(
	function ContentBlockView({ sessionId, messageId, index, block, streaming }: BlockViewProps) {
		switch (block.type) {
			case "text":
				return block.text ? <Markdown text={block.text} streaming={streaming} /> : null;
			case "thinking":
				return <ThinkingBlock text={block.thinking} streaming={streaming} storageKey={`think:${messageId}:${index}`} />;
			case "toolCall":
				return <ToolCallCard sessionId={sessionId} block={block} streaming={streaming} />;
			case "image":
				return <img src={imageDataUrl(block)} alt={t("transcript.image")} className="my-2 max-h-72 rounded-md" />;
		}
	},
	(a, b) => a.block === b.block && a.streaming === b.streaming && a.sessionId === b.sessionId,
);

function StopNotice({ message }: { message: AssistantMessageType }) {
	if (message.stopReason === "error" || message.stopReason === "aborted") {
		const isError = message.stopReason === "error";
		return (
			<div
				className={
					isError
						? "mt-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-xs"
						: "mt-2 flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-muted-foreground text-xs"
				}
			>
				{isError ? (
					<CircleAlert className="mt-0.5 size-3.5 shrink-0" />
				) : (
					<TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
				)}
				<span className="whitespace-pre-wrap break-words">
					<span className="font-medium">{isError ? t("transcript.error") : t("transcript.aborted")}</span>
					{message.errorMessage ? ` · ${message.errorMessage}` : ""}
				</span>
			</div>
		);
	}
	if (message.stopReason === "length") {
		return <p className="mt-2 text-muted-foreground text-xs">{t("transcript.stopLength")}</p>;
	}
	return null;
}

interface AssistantMessageProps {
	sessionId: string;
	message: AssistantMessageType;
	streaming: boolean;
}

export function AssistantMessage({ sessionId, message, streaming }: AssistantMessageProps) {
	const blocks = message.content;
	const last = blocks.length - 1;
	return (
		<div className="min-w-0">
			{blocks.map((block, index) => (
				<ContentBlockView
					key={block.type === "toolCall" && block.id ? `tool:${block.id}` : `${message.id}:${index}`}
					sessionId={sessionId}
					messageId={message.id}
					index={index}
					block={block}
					streaming={streaming && index === last}
				/>
			))}
			{streaming && blocks.length === 0 && (
				<div className="flex items-center gap-2 py-1 text-muted-foreground text-sm">
					<PulsingDots className="text-primary" />
				</div>
			)}
			{!streaming && <StopNotice message={message} />}
		</div>
	);
}

/** The assistant message currently being streamed; re-renders once per animation frame. */
export function StreamingRow({ sessionId }: { sessionId: string }) {
	const streaming = useSessionStore((s) => s.views[sessionId]?.streaming);
	if (!streaming) return null;
	return <AssistantMessage sessionId={sessionId} message={streaming} streaming />;
}

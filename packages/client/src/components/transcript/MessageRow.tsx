import type { Message } from "@pi-tau/shared";
import { Check, Copy } from "lucide-react";
import { memo, type ReactNode, useEffect, useMemo, useState } from "react";
import { t } from "@/i18n";
import { copyText } from "@/lib/download";
import { contentLength, copyableText } from "@/lib/messages";
import { AssistantMessage } from "./AssistantMessage";
import { BashExecutionCard } from "./BashExecutionCard";
import { CustomMessageCard, SummaryCard } from "./SummaryCard";
import { ToolResultCard } from "./ToolCallCard";
import { UserMessage } from "./UserMessage";

interface MessageRowProps {
	sessionId: string;
	message: Message;
}

function flags(message: Message): string {
	switch (message.role) {
		case "assistant":
			return `${message.stopReason}|${message.errorMessage ?? ""}`;
		case "toolResult":
			return String(message.isError);
		case "bashExecution":
			return `${message.exitCode ?? "x"}|${message.cancelled}|${message.truncated}`;
		default:
			return "";
	}
}

/** Hover-revealed copy button of a row, like the one in a code block's header. */
function MessageCopyButton({ message }: { message: Message }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(timer);
	}, [copied]);
	// Rebuilt only when the message itself changes; a finished transcript row never does.
	const text = useMemo(() => copyableText(message), [message]);
	if (!text.trim()) return null;
	return (
		<button
			type="button"
			data-testid="message-copy"
			data-copied={copied}
			aria-label={copied ? t("transcript.copied") : t("transcript.copyMessage")}
			onClick={() => void copyText(text).then((ok) => ok && setCopied(true))}
			className="absolute -top-2.5 right-0 z-10 rounded-md border border-border bg-popover p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
		>
			{copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
		</button>
	);
}

function MessageBody({ sessionId, message }: MessageRowProps): ReactNode {
	switch (message.role) {
		case "user":
			return <UserMessage message={message} />;
		case "assistant":
			return <AssistantMessage sessionId={sessionId} message={message} streaming={false} />;
		case "toolResult":
			return <ToolResultCard result={message} />;
		case "bashExecution":
			return <BashExecutionCard message={message} />;
		case "custom":
			return message.display ? <CustomMessageCard message={message} /> : null;
		case "branchSummary":
		case "compactionSummary":
			return <SummaryCard message={message} />;
	}
}

/** Finished messages never re-render while another message streams: memoized by identity, id and length. */
export const MessageRow = memo(
	function MessageRow({ sessionId, message }: MessageRowProps) {
		// A hidden custom message keeps the row empty, so it gets no copy button either.
		if (message.role === "custom" && !message.display) return null;
		return (
			<div className="group/row relative">
				<MessageBody sessionId={sessionId} message={message} />
				<MessageCopyButton message={message} />
			</div>
		);
	},
	(a, b) =>
		a.sessionId === b.sessionId &&
		(a.message === b.message ||
			(a.message.id === b.message.id &&
				a.message.role === b.message.role &&
				contentLength(a.message) === contentLength(b.message) &&
				flags(a.message) === flags(b.message))),
);

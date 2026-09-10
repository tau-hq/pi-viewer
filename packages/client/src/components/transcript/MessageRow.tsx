import type { Message } from "@pi-tau/shared";
import { memo } from "react";
import { contentLength } from "@/lib/messages";
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

/** Finished messages never re-render while another message streams: memoized by identity, id and length. */
export const MessageRow = memo(
	function MessageRow({ sessionId, message }: MessageRowProps) {
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
	},
	(a, b) =>
		a.sessionId === b.sessionId &&
		(a.message === b.message ||
			(a.message.id === b.message.id &&
				a.message.role === b.message.role &&
				contentLength(a.message) === contentLength(b.message) &&
				flags(a.message) === flags(b.message))),
);

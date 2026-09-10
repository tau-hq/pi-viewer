import type { Message } from "@pi-tau/shared";

export type TranscriptRow =
	| { kind: "message"; key: string; message: Message }
	| { kind: "streaming"; key: string }
	| { kind: "bashRun"; key: string };

/**
 * Rows of the virtual list. Tool results whose call is part of an assistant message are
 * folded into that message's tool card; hidden custom messages are skipped.
 */
export function buildRows(messages: readonly Message[]): TranscriptRow[] {
	const calls = new Set<string>();
	const seenKeys = new Set<string>();
	const rows: TranscriptRow[] = [];
	for (const message of messages) {
		if (message.role === "assistant") {
			for (const block of message.content) if (block.type === "toolCall") calls.add(block.id);
		}
		if (message.role === "toolResult" && calls.has(message.toolCallId)) continue;
		if (message.role === "custom" && !message.display) continue;
		let key = message.id;
		if (seenKeys.has(key)) key = `${key}#${rows.length}`;
		seenKeys.add(key);
		rows.push({ kind: "message", key, message });
	}
	return rows;
}

import type { ContentBlock, ImageBlock, Message, TextBlock, ToolResultMessage } from "@pi-tau/shared";

/** Plain text of any message, used for previews, search and de-duplication. */
export function messageText(message: Message): string {
	switch (message.role) {
		case "user":
		case "assistant":
			return blocksText(message.content);
		case "toolResult":
			return blocksText(message.content);
		case "bashExecution":
			return message.command;
		case "custom":
			return typeof message.content === "string" ? message.content : blocksText(message.content);
		case "branchSummary":
		case "compactionSummary":
			return message.summary;
	}
}

/**
 * What the copy button of a message row puts on the clipboard: the plain text a reader sees.
 * Assistant messages lose their thinking blocks (`blocksText` keeps text blocks only), tool
 * results keep their line breaks, and a shell card carries its command plus the output.
 */
export function copyableText(message: Message): string {
	switch (message.role) {
		case "toolResult":
			return toolResultText(message);
		case "bashExecution": {
			const output = message.output.replace(/\s+$/, "");
			return output ? `${message.command}\n${output}` : message.command;
		}
		default:
			return messageText(message);
	}
}

/**
 * Text of the newest assistant message that has any, for pi's `/copy`. Assistant messages that
 * only carry tool calls are skipped: they would copy an empty string.
 */
export function lastAssistantText(messages: readonly Message[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role !== "assistant") continue;
		const text = blocksText(message.content).trim();
		if (text.length > 0) return text;
	}
	return undefined;
}

export function blocksText(blocks: readonly ContentBlock[]): string {
	let out = "";
	for (const block of blocks) {
		if (block.type === "text") out += block.text;
	}
	return out;
}

export function imageBlocks(blocks: readonly ContentBlock[]): ImageBlock[] {
	return blocks.filter((block): block is ImageBlock => block.type === "image");
}

export function toolResultText(result: ToolResultMessage): string {
	return result.content
		.filter((block): block is TextBlock => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

export interface LinePreview {
	lines: string[];
	hiddenCount: number;
}

/** First `max` lines of a text plus how many were cut. */
export function previewLines(text: string, max: number): LinePreview {
	const lines = text.replace(/\s+$/, "").split("\n");
	if (lines.length <= max) return { lines, hiddenCount: 0 };
	return { lines: lines.slice(0, max), hiddenCount: lines.length - max };
}

const ARG_KEYS = [
	"path",
	"file_path",
	"filePath",
	"command",
	"cmd",
	"pattern",
	"query",
	"url",
	"glob",
	"directory",
	"dir",
];

/** One-line summary of tool arguments: the most descriptive argument value, or compact JSON. */
export function toolArgSummary(args: unknown, max = 120): string {
	if (typeof args === "string") return truncate(args, max);
	if (typeof args !== "object" || args === null) return "";
	const record = args as Record<string, unknown>;
	for (const key of ARG_KEYS) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) return truncate(value.replace(/\s+/g, " "), max);
	}
	const entries = Object.entries(record).filter(([, value]) => value !== undefined);
	if (entries.length === 0) return "";
	const summary = entries
		.map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
		.join(", ");
	return truncate(summary.replace(/\s+/g, " "), max);
}

/** Parse streamed tool arguments: prefer the parsed object, fall back to the partial JSON text. */
export function toolArgs(argumentsValue: unknown, partialJson: string | undefined): unknown {
	if (argumentsValue !== undefined && argumentsValue !== null && argumentsValue !== "") return argumentsValue;
	if (!partialJson) return undefined;
	try {
		return JSON.parse(partialJson);
	} catch {
		return partialJson;
	}
}

export function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Stable cheap signature of a message used by memoized renderers. */
export function contentLength(message: Message): number {
	switch (message.role) {
		case "user":
		case "assistant":
			return message.content.reduce((sum, block) => sum + blockLength(block), 0);
		case "toolResult":
			return message.content.reduce((sum, block) => sum + blockLength(block), 0);
		case "bashExecution":
			return message.output.length;
		case "custom":
			return typeof message.content === "string" ? message.content.length : message.content.length;
		case "branchSummary":
		case "compactionSummary":
			return message.summary.length;
	}
}

function blockLength(block: ContentBlock): number {
	switch (block.type) {
		case "text":
			return block.text.length;
		case "thinking":
			return block.thinking.length;
		case "image":
			return block.data.length;
		case "toolCall":
			return (block.partialJson?.length ?? 0) + (block.arguments === undefined ? 0 : 1);
	}
}

import type {
	AssistantMessage,
	BashExecutionMessage,
	CompactionSummaryMessage,
	Message,
	ToolResultMessage,
	UserMessage,
} from "@pi-tau/shared";
import { describe, expect, it } from "vitest";
import { copyableText, lastAssistantText } from "./messages";

function assistant(id: string, ...texts: string[]): AssistantMessage {
	return {
		role: "assistant",
		id,
		content: texts.map((text) => ({ type: "text", text })),
		provider: "nebius",
		model: "glm",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
		stopReason: "stop",
		timestamp: 0,
	};
}

function user(id: string, text: string): UserMessage {
	return { role: "user", id, content: [{ type: "text", text }], timestamp: 0 };
}

describe("lastAssistantText", () => {
	it("takes the newest assistant message and joins its text blocks", () => {
		const messages: Message[] = [assistant("a", "old"), user("u", "question"), assistant("b", "new", " parts")];
		expect(lastAssistantText(messages)).toBe("new parts");
	});

	it("skips assistant messages that only carry tool calls", () => {
		const toolOnly: AssistantMessage = {
			...assistant("t"),
			content: [{ type: "toolCall", id: "1", name: "bash", arguments: {} }],
		};
		expect(lastAssistantText([assistant("a", "answer"), toolOnly])).toBe("answer");
	});

	it("is undefined without any assistant text", () => {
		expect(lastAssistantText([user("u", "hi")])).toBeUndefined();
		expect(lastAssistantText([])).toBeUndefined();
	});
});

describe("copyableText", () => {
	it("takes a user message as it was typed", () => {
		expect(copyableText(user("u", "read the protocol"))).toBe("read the protocol");
	});

	it("joins the text blocks of an assistant message and leaves thinking and tool calls out", () => {
		const message: AssistantMessage = {
			...assistant("a", "answer"),
			content: [
				{ type: "thinking", thinking: "secret reasoning" },
				{ type: "text", text: "visible " },
				{ type: "toolCall", id: "1", name: "bash", arguments: {} },
				{ type: "text", text: "answer" },
			],
		};
		expect(copyableText(message)).toBe("visible answer");
	});

	it("keeps the line breaks of a tool result", () => {
		const result: ToolResultMessage = {
			role: "toolResult",
			id: "r",
			toolCallId: "1",
			toolName: "read",
			content: [
				{ type: "text", text: "first" },
				{ type: "text", text: "second" },
			],
			isError: false,
			timestamp: 0,
		};
		expect(copyableText(result)).toBe("first\nsecond");
	});

	it("puts the command of a shell card in front of its output", () => {
		const bash: BashExecutionMessage = {
			role: "bashExecution",
			id: "b",
			command: "echo hi",
			output: "hi\n\n",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			timestamp: 0,
		};
		expect(copyableText(bash)).toBe("echo hi\nhi");
		expect(copyableText({ ...bash, output: "  \n" })).toBe("echo hi");
	});

	it("takes the summary of a compaction", () => {
		const summary: CompactionSummaryMessage = {
			role: "compactionSummary",
			id: "c",
			summary: "what happened so far",
			tokensBefore: 100,
			timestamp: 0,
		};
		expect(copyableText(summary)).toBe("what happened so far");
	});
});

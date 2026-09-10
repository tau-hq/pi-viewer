import type { AssistantMessage, Message, UserMessage } from "@pi-tau/shared";
import { describe, expect, it } from "vitest";
import { lastAssistantText } from "./messages";

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

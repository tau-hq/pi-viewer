import type {
	AssistantMessage,
	Message,
	SessionEvent,
	SessionSnapshot,
	ToolResultMessage,
	UserMessage,
} from "@pi-tau/shared";
import { describe, expect, it } from "vitest";
import { applySessionEvent, applySnapshot, createSessionView, type SessionView } from "./session-reducer";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };

function assistant(id: string, content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]) {
	return {
		role: "assistant",
		id,
		content,
		provider: "nebius",
		model: "zai-org/GLM-5.3-Flash",
		usage,
		stopReason,
		timestamp: 1788991958365,
	} satisfies AssistantMessage;
}

function user(id: string, text: string, timestamp = 1788991958218): UserMessage {
	return { role: "user", id, content: [{ type: "text", text }], timestamp };
}

function toolResult(id: string, toolCallId: string, text: string): ToolResultMessage {
	return {
		role: "toolResult",
		id,
		toolCallId,
		toolName: "read",
		content: [{ type: "text", text }],
		isError: false,
		timestamp: 1788991964044,
	};
}

function reduce(events: SessionEvent[], start: SessionView = createSessionView("s1")): SessionView {
	return events.reduce((view, event) => applySessionEvent(view, event), start);
}

function snapshot(messages: Message[] = []): SessionSnapshot {
	return {
		state: {
			sessionId: "s1",
			cwd: "/srv/pi-tau",
			thinkingLevel: "medium",
			isStreaming: false,
			isCompacting: false,
			steeringMode: "one-at-a-time",
			followUpMode: "one-at-a-time",
			autoCompactionEnabled: true,
			autoRetryEnabled: true,
			messageCount: messages.length,
			pendingMessageCount: 0,
			processAlive: true,
		},
		messages,
		queue: { steering: [], followUp: [] },
		activeTools: [],
		statuses: {},
		widgets: {},
		pendingUi: [],
	};
}

describe("applySnapshot", () => {
	it("builds a loaded view and indexes tool results", () => {
		const result = toolResult("m3", "call_1", "{}");
		const view = applySnapshot(undefined, 7, snapshot([user("m1", "hi"), result]));
		expect(view.loaded).toBe(true);
		expect(view.lastSeq).toBe(7);
		expect(view.messages).toHaveLength(2);
		expect(view.toolResults.call_1).toBe(result);
		expect(view.state.cwd).toBe("/srv/pi-tau");
	});
});

describe("streaming text sequence (from rpc-sample-0.85.1)", () => {
	const events: SessionEvent[] = [
		{ type: "run.start" },
		{ type: "turn.start" },
		{ type: "message.start", message: user("u1", "Wie heisst die Hauptstadt von Frankreich?") },
		{ type: "message.end", message: user("u1", "Wie heisst die Hauptstadt von Frankreich?") },
		{ type: "message.start", message: assistant("a1", [], "pending") },
		{ type: "block.start", messageId: "a1", contentIndex: 0, block: { type: "text", text: "" } },
		{ type: "block.delta", messageId: "a1", contentIndex: 0, kind: "text", delta: "Die Hauptstadt von" },
		{ type: "block.delta", messageId: "a1", contentIndex: 0, kind: "text", delta: " Frankreich ist **" },
		{ type: "block.delta", messageId: "a1", contentIndex: 0, kind: "text", delta: "Paris**." },
		{
			type: "block.end",
			messageId: "a1",
			contentIndex: 0,
			block: { type: "text", text: "Die Hauptstadt von Frankreich ist **Paris**." },
		},
	];

	it("accumulates deltas into the streaming message without touching messages", () => {
		const view = reduce(events);
		expect(view.runActive).toBe(true);
		expect(view.state.isStreaming).toBe(true);
		expect(view.messages).toHaveLength(1); // the user message, once
		expect(view.streaming?.id).toBe("a1");
		expect(view.streaming?.content).toEqual([{ type: "text", text: "Die Hauptstadt von Frankreich ist **Paris**." }]);
	});

	it("keeps identity of untouched fields while streaming", () => {
		const before = reduce(events.slice(0, 7));
		const after = applySessionEvent(before, events[7] as SessionEvent);
		expect(after.messages).toBe(before.messages);
		expect(after.state).toBe(before.state);
		expect(after.streaming).not.toBe(before.streaming);
	});

	it("finalizes on message.end and clears streaming; run.settled ends the run", () => {
		const final = assistant("a1", [{ type: "text", text: "Die Hauptstadt von Frankreich ist **Paris**." }], "stop");
		const view = reduce([
			...events,
			{ type: "message.end", message: final },
			{ type: "turn.end" },
			{ type: "run.end", willRetry: false },
			{ type: "run.settled" },
		]);
		expect(view.streaming).toBeUndefined();
		expect(view.messages).toHaveLength(2);
		expect(view.messages[1]).toBe(final);
		expect(view.runActive).toBe(false);
		expect(view.state.isStreaming).toBe(false);
	});

	it("does not duplicate a user message that arrives with the same id twice", () => {
		const view = reduce([
			{ type: "message.start", message: user("u1", "a") },
			{ type: "message.end", message: user("u1", "a") },
		]);
		expect(view.messages).toHaveLength(1);
	});

	it("dedupes by role, timestamp and text when ids differ", () => {
		const view = reduce([
			{ type: "message.start", message: user("tmp-1", "a", 5) },
			{ type: "message.end", message: user("entry-9", "a", 5) },
		]);
		expect(view.messages).toHaveLength(1);
		expect(view.messages[0]?.id).toBe("entry-9");
	});

	it("creates a placeholder streaming message when deltas arrive without message.start", () => {
		const view = reduce([{ type: "block.delta", messageId: "a9", contentIndex: 0, kind: "text", delta: "x" }]);
		expect(view.streaming?.id).toBe("a9");
		expect(view.streaming?.content).toEqual([{ type: "text", text: "x" }]);
	});

	it("keeps a dangling streaming message when the run ends without message.end", () => {
		const view = reduce([...events, { type: "run.end", willRetry: false }]);
		expect(view.streaming).toBeUndefined();
		const last = view.messages.at(-1);
		expect(last?.role).toBe("assistant");
		expect(last && last.role === "assistant" ? last.stopReason : undefined).toBe("aborted");
	});
});

describe("tool call sequence (from rpc-sample-0.85.1)", () => {
	const args = { path: "package.json", offset: 1, limit: 30 };
	const thinkingText = "The user wants me to read package.json. Let me use the read tool.";
	const finalAssistant = assistant(
		"a2",
		[
			{ type: "thinking", thinking: thinkingText },
			{ type: "toolCall", id: "call_1", name: "read", arguments: args },
		],
		"toolUse",
	);
	const result = toolResult("r1", "call_1", '{\n  "name": "pi-tau"\n}');
	const events: SessionEvent[] = [
		{ type: "run.start" },
		{ type: "message.start", message: assistant("a2", [], "pending") },
		{ type: "block.start", messageId: "a2", contentIndex: 0, block: { type: "thinking", thinking: "" } },
		{ type: "block.delta", messageId: "a2", contentIndex: 0, kind: "thinking", delta: "The user wants me to" },
		{ type: "block.delta", messageId: "a2", contentIndex: 0, kind: "thinking", delta: " read package.json." },
		{
			type: "block.start",
			messageId: "a2",
			contentIndex: 1,
			block: { type: "toolCall", id: "call_1", name: "read", arguments: undefined, partialJson: "" },
		},
		{ type: "block.delta", messageId: "a2", contentIndex: 1, kind: "toolArgs", delta: '{"path": "package' },
		{
			type: "block.delta",
			messageId: "a2",
			contentIndex: 1,
			kind: "toolArgs",
			delta: '.json", "offset": 1, "limit": 30}',
		},
		{ type: "block.end", messageId: "a2", contentIndex: 0, block: { type: "thinking", thinking: thinkingText } },
		{
			type: "block.end",
			messageId: "a2",
			contentIndex: 1,
			block: { type: "toolCall", id: "call_1", name: "read", arguments: args },
		},
		{ type: "message.end", message: finalAssistant },
		{ type: "tool.start", run: { toolCallId: "call_1", toolName: "read", args, startedAt: 1 } },
		{ type: "tool.update", toolCallId: "call_1", partial: "{\n" },
		{ type: "tool.end", toolCallId: "call_1", result },
		{ type: "message.start", message: result },
		{ type: "message.end", message: result },
		{ type: "turn.end" },
	];

	it("streams thinking and tool arguments by content index", () => {
		const view = reduce(events.slice(0, 8));
		expect(view.streaming?.content[0]).toEqual({
			type: "thinking",
			thinking: "The user wants me to read package.json.",
		});
		const call = view.streaming?.content[1];
		expect(call?.type).toBe("toolCall");
		if (call?.type === "toolCall") {
			expect(call.partialJson).toBe('{"path": "package.json", "offset": 1, "limit": 30}');
			expect(call.name).toBe("read");
		}
	});

	it("tracks active tools with cumulative partial results", () => {
		const view = reduce(events.slice(0, 13));
		expect(view.activeTools).toHaveLength(1);
		expect(view.activeTools[0]?.partial).toBe("{\n");
	});

	it("appends the tool result once even though tool.end and message.end both carry it", () => {
		const view = reduce(events);
		const results = view.messages.filter((m) => m.role === "toolResult");
		expect(results).toHaveLength(1);
		expect(view.toolResults.call_1).toBe(result);
		expect(view.activeTools).toHaveLength(0);
		expect(view.messages.map((m) => m.role)).toEqual(["assistant", "toolResult"]);
	});

	it("dedupes tool results by toolCallId when ids differ", () => {
		const view = reduce([
			{ type: "tool.end", toolCallId: "call_1", result: toolResult("host-generated", "call_1", "x") },
			{ type: "message.end", message: toolResult("entry-id", "call_1", "x") },
		]);
		expect(view.messages).toHaveLength(1);
		expect(view.messages[0]?.id).toBe("entry-id");
	});
});

describe("other events", () => {
	it("replaces the transcript and drops a streaming message that is included", () => {
		const streamingView = reduce([{ type: "message.start", message: assistant("a1", [], "pending") }]);
		const final = assistant("a1", [{ type: "text", text: "done" }], "stop");
		const view = applySessionEvent(streamingView, {
			type: "transcript.replace",
			messages: [user("u1", "q"), final],
			leafId: "a1",
		});
		expect(view.messages).toHaveLength(2);
		expect(view.streaming).toBeUndefined();
		expect(view.leafId).toBe("a1");
	});

	it("merges state.update and stores stats", () => {
		const view = reduce([
			{ type: "state.update", state: { sessionName: "Renamed", isStreaming: true } },
			{
				type: "stats.update",
				stats: {
					userMessages: 1,
					assistantMessages: 1,
					toolCalls: 0,
					toolResults: 0,
					totalMessages: 2,
					tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
					cost: 0.01,
				},
			},
		]);
		expect(view.state.sessionName).toBe("Renamed");
		expect(view.state.isStreaming).toBe(true);
		expect(view.state.cwd).toBe("");
		expect(view.stats?.tokens.total).toBe(15);
	});

	it("manages queue, ui requests, statuses and widgets", () => {
		const view = reduce([
			{ type: "queue.update", steering: ["stop"], followUp: ["next"] },
			{ type: "ui.request", request: { id: "q1", method: "confirm", title: "Sure?", message: "m" } },
			{ type: "ui.request", request: { id: "q2", method: "select", title: "Pick", options: ["a", "b"] } },
			{ type: "ui.resolved", requestId: "q1" },
			{ type: "status.set", key: "git", text: "main" },
			{ type: "status.set", key: "tmp", text: "x" },
			{ type: "status.set", key: "tmp" },
			{ type: "widget.set", key: "w", widget: { lines: ["l1"], placement: "aboveEditor" } },
			{ type: "widget.set", key: "w" },
		]);
		expect(view.queue).toEqual({ steering: ["stop"], followUp: ["next"] });
		expect(view.pendingUi.map((r) => r.id)).toEqual(["q2"]);
		expect(view.statuses).toEqual({ git: "main" });
		expect(view.widgets).toEqual({});
	});

	it("tracks retries, compaction, bash output, title and editor text", () => {
		const view = reduce([
			{ type: "retry.start", attempt: 1, maxAttempts: 3, delayMs: 1000, errorMessage: "overloaded" },
			{ type: "compaction.start", reason: "threshold" },
			{ type: "bash.output", commandId: "c1", delta: "line1\n" },
			{ type: "bash.output", commandId: "c1", delta: "line2\n" },
			{ type: "title.set", title: "Tau – work" },
			{ type: "editor.set", text: "prefilled" },
		]);
		expect(view.retry?.attempt).toBe(1);
		expect(view.state.isCompacting).toBe(true);
		expect(view.bashRun?.output).toBe("line1\nline2\n");
		expect(view.title).toBe("Tau – work");
		expect(view.editorRequest).toEqual({ text: "prefilled", nonce: 1 });

		const done = reduce(
			[
				{ type: "retry.end", success: true, attempt: 2 },
				{ type: "compaction.end", reason: "threshold", aborted: false },
				{
					type: "message.end",
					message: {
						role: "bashExecution",
						id: "b1",
						command: "ls",
						output: "line1\nline2\n",
						exitCode: 0,
						cancelled: false,
						truncated: false,
						timestamp: 3,
					},
				},
			],
			view,
		);
		expect(done.retry).toBeUndefined();
		expect(done.state.isCompacting).toBe(false);
		expect(done.bashRun).toBeUndefined();
		expect(done.messages.at(-1)?.role).toBe("bashExecution");
	});

	it("keeps a finished local bash run until the host's bashExecution arrives", () => {
		const result = { output: "a\nb\n", exitCode: 0, cancelled: false, truncated: false };
		let view: SessionView = {
			...createSessionView("s1"),
			bashRun: { commandId: "c1", command: "ls", output: "a\n", startedAt: 1, result },
		};
		// deltas that were batched behind the answer do not reopen the run
		view = applySessionEvent(view, { type: "bash.output", commandId: "c1", delta: "b\n" });
		expect(view.bashRun?.output).toBe("a\n");
		expect(view.bashRun?.result).toBe(result);
		const other = {
			role: "bashExecution",
			id: "b0",
			command: "pwd",
			output: "/",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			timestamp: 5,
		} satisfies Message;
		view = applySessionEvent(view, { type: "transcript.replace", messages: [other] });
		expect(view.bashRun).toBeDefined();
		const mine = { ...other, id: "b1", command: "ls", output: "a\nb\n" };
		view = applySessionEvent(view, { type: "transcript.replace", messages: [other, mine] });
		expect(view.bashRun).toBeUndefined();
	});

	it("marks the process dead on process.exit and finalizes streaming output", () => {
		const view = reduce([
			{ type: "run.start" },
			{ type: "message.start", message: assistant("a1", [{ type: "text", text: "partial" }], "pending") },
			{ type: "process.exit", code: 1 },
		]);
		expect(view.state.processAlive).toBe(false);
		expect(view.state.isStreaming).toBe(false);
		expect(view.runActive).toBe(false);
		expect(view.processExit).toEqual({ code: 1, signal: undefined });
		expect(view.messages.at(-1)?.role).toBe("assistant");
	});

	it("returns the same view for events without state impact", () => {
		const view = createSessionView("s1");
		expect(applySessionEvent(view, { type: "notify", message: "hi", level: "info" })).toBe(view);
		expect(applySessionEvent(view, { type: "turn.start" })).toBe(view);
	});
});

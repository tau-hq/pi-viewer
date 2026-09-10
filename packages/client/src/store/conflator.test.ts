import type { SessionEvent } from "@pi-tau/shared";
import { describe, expect, it } from "vitest";
import { EventConflator, type Scheduler } from "./conflator";

function manualScheduler(): { scheduler: Scheduler; run: () => void; scheduled: number } {
	const state = { flush: undefined as (() => void) | undefined, scheduled: 0 };
	const scheduler: Scheduler = (flush) => {
		state.flush = flush;
		state.scheduled += 1;
		return () => {
			state.flush = undefined;
		};
	};
	return {
		scheduler,
		run: () => state.flush?.(),
		get scheduled() {
			return state.scheduled;
		},
	};
}

function delta(text: string, index = 0, messageId = "a1"): SessionEvent {
	return { type: "block.delta", messageId, contentIndex: index, kind: "text", delta: text };
}

describe("EventConflator", () => {
	it("merges deltas of the same block and applies them once per flush", () => {
		const applied: Array<{ seq: number; event: SessionEvent }> = [];
		const manual = manualScheduler();
		const conflator = new EventConflator((_sid, seq, event) => applied.push({ seq, event }), manual.scheduler);
		conflator.push("s", 1, delta("Hel"));
		conflator.push("s", 2, delta("lo"));
		conflator.push("s", 3, delta(" wo"));
		expect(applied).toHaveLength(0);
		expect(manual.scheduled).toBe(1);
		manual.run();
		expect(applied).toHaveLength(1);
		expect(applied[0]?.seq).toBe(3);
		expect(applied[0]?.event).toEqual(delta("Hello wo"));
	});

	it("keeps separate keys apart and preserves first-arrival order", () => {
		const applied: SessionEvent[] = [];
		const { scheduler, run } = manualScheduler();
		const conflator = new EventConflator((_sid, _seq, event) => applied.push(event), scheduler);
		conflator.push("s", 1, delta("a", 0));
		conflator.push("s", 2, { type: "block.delta", messageId: "a1", contentIndex: 1, kind: "thinking", delta: "t1" });
		conflator.push("s", 3, delta("b", 0));
		conflator.push("s", 4, { type: "bash.output", commandId: "c", delta: "x" });
		conflator.push("s", 5, { type: "bash.output", commandId: "c", delta: "y" });
		run();
		expect(applied).toEqual([
			delta("ab", 0),
			{ type: "block.delta", messageId: "a1", contentIndex: 1, kind: "thinking", delta: "t1" },
			{ type: "bash.output", commandId: "c", delta: "xy" },
		]);
	});

	it("flushes pending deltas before a control event so order is preserved", () => {
		const applied: SessionEvent[] = [];
		const { scheduler } = manualScheduler();
		const conflator = new EventConflator((_sid, _seq, event) => applied.push(event), scheduler);
		conflator.push("s", 1, delta("partial"));
		const end: SessionEvent = {
			type: "block.end",
			messageId: "a1",
			contentIndex: 0,
			block: { type: "text", text: "partial" },
		};
		conflator.push("s", 2, end);
		expect(applied).toEqual([delta("partial"), end]);
		expect(conflator.size).toBe(0);
	});

	it("keeps only the latest cumulative tool.update per tool call", () => {
		const applied: SessionEvent[] = [];
		const { scheduler, run } = manualScheduler();
		const conflator = new EventConflator((_sid, _seq, event) => applied.push(event), scheduler);
		conflator.push("s", 1, { type: "tool.update", toolCallId: "t", partial: "1" });
		conflator.push("s", 2, { type: "tool.update", toolCallId: "t", partial: "12" });
		run();
		expect(applied).toEqual([{ type: "tool.update", toolCallId: "t", partial: "12" }]);
	});

	it("does not mix sessions", () => {
		const applied: Array<[string, SessionEvent]> = [];
		const { scheduler, run } = manualScheduler();
		const conflator = new EventConflator((sid, _seq, event) => applied.push([sid, event]), scheduler);
		conflator.push("s1", 1, delta("a"));
		conflator.push("s2", 1, delta("b"));
		run();
		expect(applied).toEqual([
			["s1", delta("a")],
			["s2", delta("b")],
		]);
	});
});

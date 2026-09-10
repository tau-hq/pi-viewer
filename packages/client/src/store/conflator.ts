import type { SessionEvent } from "@pi-tau/shared";

/**
 * Batches high-frequency streaming events so React commits at most once per animation
 * frame. Append-only events (block.delta, bash.output) are concatenated per key, cumulative
 * ones (tool.update) keep the latest value. Every other event flushes the pending batch
 * first and is applied immediately, so ordering is identical to applying events one by one.
 */

export type ApplyEvent = (sessionId: string, seq: number, event: SessionEvent) => void;
export type Scheduler = (flush: () => void) => () => void;

const HIDDEN_FALLBACK_MS = 250;

/** rAF when the tab is visible; a timer takes over when rAF is throttled or unavailable. */
const frameScheduler: Scheduler = (flush) => {
	let done = false;
	const run = () => {
		if (done) return;
		done = true;
		if (raf !== undefined) cancelAnimationFrame(raf);
		clearTimeout(timer);
		flush();
	};
	const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame(run) : undefined;
	const timer = setTimeout(run, HIDDEN_FALLBACK_MS);
	return () => {
		done = true;
		if (raf !== undefined) cancelAnimationFrame(raf);
		clearTimeout(timer);
	};
};

interface Pending {
	sessionId: string;
	seq: number;
	event: SessionEvent;
}

function conflationKey(sessionId: string, event: SessionEvent): string | undefined {
	switch (event.type) {
		case "block.delta":
			return `${sessionId}|delta|${event.messageId}|${event.contentIndex}|${event.kind}`;
		case "bash.output":
			return `${sessionId}|bash|${event.commandId}`;
		case "tool.update":
			return `${sessionId}|tool|${event.toolCallId}`;
		default:
			return undefined;
	}
}

function merge(existing: SessionEvent, incoming: SessionEvent): SessionEvent {
	if (existing.type === "block.delta" && incoming.type === "block.delta") {
		return { ...existing, delta: existing.delta + incoming.delta };
	}
	if (existing.type === "bash.output" && incoming.type === "bash.output") {
		return { ...existing, delta: existing.delta + incoming.delta };
	}
	return incoming; // tool.update carries the cumulative partial: latest wins
}

export class EventConflator {
	private pending: Pending[] = [];
	private readonly index = new Map<string, number>();
	private cancel: (() => void) | undefined;

	constructor(
		private readonly apply: ApplyEvent,
		private readonly schedule: Scheduler = frameScheduler,
	) {}

	push(sessionId: string, seq: number, event: SessionEvent): void {
		const key = conflationKey(sessionId, event);
		if (key === undefined) {
			this.flush();
			this.apply(sessionId, seq, event);
			return;
		}
		const position = this.index.get(key);
		const existing = position === undefined ? undefined : this.pending[position];
		if (existing) {
			existing.event = merge(existing.event, event);
			existing.seq = seq;
		} else {
			this.index.set(key, this.pending.length);
			this.pending.push({ sessionId, seq, event });
		}
		if (!this.cancel) this.cancel = this.schedule(() => this.flush());
	}

	/** Apply everything buffered so far, in arrival order. Idempotent. */
	flush(): void {
		if (this.cancel) {
			this.cancel();
			this.cancel = undefined;
		}
		if (this.pending.length === 0) return;
		const batch = this.pending;
		this.pending = [];
		this.index.clear();
		for (const item of batch) this.apply(item.sessionId, item.seq, item.event);
	}

	get size(): number {
		return this.pending.length;
	}

	dispose(): void {
		this.flush();
	}
}

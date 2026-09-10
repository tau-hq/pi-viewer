import type { SessionCommand } from "@pi-tau/shared";

export type QueueKind = "steering" | "followUp";

export interface QueueEntry {
	kind: QueueKind;
	text: string;
	/** Position within its own list, which is how an entry is addressed for removal. */
	index: number;
	key: string;
}

export interface QueueLists {
	steering: string[];
	followUp: string[];
}

/** Steering entries first, then follow-ups: the order in which pi hands them over. */
export function queueEntries(steering: readonly string[], followUp: readonly string[]): QueueEntry[] {
	return [
		...steering.map((text, index) => ({ kind: "steering" as const, text, index, key: `s:${index}:${text}` })),
		...followUp.map((text, index) => ({ kind: "followUp" as const, text, index, key: `f:${index}:${text}` })),
	];
}

/** The `clearQueue` result: the entries the host took out of the queue. */
export function parseClearedQueue(data: unknown): QueueLists {
	const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
	const list = (value: unknown): string[] =>
		Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
	return { steering: list(record.steering), followUp: list(record.followUp) };
}

/**
 * pi can only clear the whole queue, so removing one entry means clearing and queueing the rest
 * again. The entries come from the `clearQueue` result, not from the rendered list, so a queue
 * that changed in between is still restored completely: the removal then simply does not apply.
 */
export function requeueCommands(cleared: QueueLists, removed: QueueEntry): SessionCommand[] {
	const source = removed.kind === "steering" ? cleared.steering : cleared.followUp;
	let dropAt = source[removed.index] === removed.text ? removed.index : source.indexOf(removed.text);
	if (dropAt < 0) dropAt = Number.NaN;
	const keep = (kind: QueueKind, list: readonly string[]) =>
		list.filter((_text, index) => !(kind === removed.kind && index === dropAt));
	return [
		...keep("steering", cleared.steering).map((message): SessionCommand => ({ type: "steer", message })),
		...keep("followUp", cleared.followUp).map((message): SessionCommand => ({ type: "followUp", message })),
	];
}

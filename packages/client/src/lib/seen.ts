/**
 * "Seen" marks for the sidebar circles: per session id the `modified` timestamp the user last
 * looked at. Purely client-side — the host has no notion of it — and kept in localStorage so a
 * reload does not light the whole list up again.
 */

import { readStorage, writeStorage } from "./storage";

const SEEN_KEY = "tau.seen";
/** Enough for any realistic session list; the oldest marks are dropped first. */
export const SEEN_LIMIT = 200;

export type SeenMap = Record<string, number>;

/** Tolerant parse: anything that is not a `{ id: timestamp }` object yields no marks at all. */
export function parseSeen(raw: string | null): SeenMap {
	if (raw === null) return {};
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return {};
	}
	if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
	const map: SeenMap = {};
	for (const [id, value] of Object.entries(data)) {
		if (typeof value === "number" && Number.isFinite(value)) map[id] = value;
	}
	return map;
}

/** Keep the `limit` most recently seen sessions so the entry cannot grow forever. */
export function pruneSeen(map: SeenMap, limit: number = SEEN_LIMIT): SeenMap {
	const entries = Object.entries(map);
	if (entries.length <= limit) return map;
	entries.sort((a, b) => b[1] - a[1]);
	return Object.fromEntries(entries.slice(0, limit));
}

export function readSeen(): SeenMap {
	return parseSeen(readStorage(SEEN_KEY));
}

export function writeSeen(map: SeenMap): void {
	writeStorage(SEEN_KEY, JSON.stringify(map));
}

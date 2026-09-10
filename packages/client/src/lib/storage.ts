/** localStorage access that tolerates private mode and disabled storage. */

export function readStorage(key: string): string | null {
	try {
		return globalThis.localStorage?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

export function writeStorage(key: string, value: string): void {
	try {
		globalThis.localStorage?.setItem(key, value);
	} catch {
		// storage may be unavailable (private mode); the setting is then session-only
	}
}

/** Stored number within [min, max]; the fallback covers a missing or unparsable value. */
export function readStoredNumber(key: string, fallback: number, min: number, max: number): number {
	const raw = readStorage(key);
	if (raw === null) return fallback;
	const value = Number.parseInt(raw, 10);
	if (!Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

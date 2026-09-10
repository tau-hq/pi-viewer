/**
 * Helpers for reading command results. The protocol types command results as `unknown`;
 * we accept both a bare array/value and an object wrapping it under a well-known key,
 * e.g. `models.list` -> `ModelInfo[]` or `{ models: ModelInfo[] }`.
 */

export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function pickArray<T>(data: unknown, key: string): T[] {
	if (Array.isArray(data)) return data as T[];
	const nested = asRecord(data)?.[key];
	return Array.isArray(nested) ? (nested as T[]) : [];
}

/** Result of the `bash` session command; missing fields get safe defaults. */
export function parseBashResult(data: unknown): {
	output: string;
	exitCode: number | undefined;
	cancelled: boolean;
	truncated: boolean;
} {
	const record = asRecord(data) ?? {};
	return {
		output: typeof record.output === "string" ? record.output : "",
		exitCode: typeof record.exitCode === "number" ? record.exitCode : undefined,
		cancelled: record.cancelled === true,
		truncated: record.truncated === true,
	};
}

export function pickString(data: unknown, ...keys: string[]): string | undefined {
	if (typeof data === "string") return data;
	const record = asRecord(data);
	if (!record) return undefined;
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

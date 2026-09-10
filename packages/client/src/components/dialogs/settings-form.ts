/**
 * Pure helpers for the typed settings form: reading values out of pi's settings JSON,
 * merging the two scopes the way pi does, and turning edits into a `settings.patch` body.
 */

export type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a settings file; anything that is not a JSON object becomes an empty object. */
export function parseSettings(text: string): JsonRecord {
	if (text.trim().length === 0) return {};
	try {
		const value = JSON.parse(text) as unknown;
		return isRecord(value) ? value : {};
	} catch {
		return {};
	}
}

/** Deep merge like pi's settings resolution: objects merge, everything else replaces. */
export function mergeSettings(base: JsonRecord, over: JsonRecord): JsonRecord {
	const out: JsonRecord = { ...base };
	for (const [key, value] of Object.entries(over)) {
		const current = out[key];
		out[key] = isRecord(value) && isRecord(current) ? mergeSettings(current, value) : value;
	}
	return out;
}

/** Value at a dotted path, or undefined when any step is missing. */
export function readPath(source: JsonRecord, path: string): unknown {
	let node: unknown = source;
	for (const part of path.split(".")) {
		if (!isRecord(node)) return undefined;
		node = node[part];
	}
	return node;
}

/** Nested patch body from dotted paths; a null value asks the host to delete the key. */
export function buildPatch(draft: Readonly<Record<string, unknown>>): JsonRecord {
	const patch: JsonRecord = {};
	for (const [path, value] of Object.entries(draft)) {
		const parts = path.split(".");
		let node = patch;
		for (const part of parts.slice(0, -1)) {
			const next = node[part];
			if (!isRecord(next)) node[part] = {};
			node = node[part] as JsonRecord;
		}
		node[parts[parts.length - 1] as string] = value;
	}
	return patch;
}

export function asBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asText(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.filter((entry): entry is string => typeof entry === "string");
}

export interface MappingRow {
	key: string;
	value: string;
}

/** `modelThinkingLevels` as editable rows; a non-object value yields no rows. */
export function asRows(value: unknown): MappingRow[] {
	if (!isRecord(value)) return [];
	return Object.entries(value)
		.filter(([, level]) => typeof level === "string")
		.map(([key, level]) => ({ key, value: level as string }));
}

/** Rows back to pi's record; empty keys are dropped, an empty result deletes the key. */
export function rowsToRecord(rows: readonly MappingRow[]): JsonRecord | null {
	const out: JsonRecord = {};
	for (const row of rows) {
		const key = row.key.trim();
		if (key.length > 0) out[key] = row.value;
	}
	return Object.keys(out).length === 0 ? null : out;
}

/** Toggle one name in a selection, keeping the given order stable. */
export function toggleName(selected: readonly string[], name: string, order: readonly string[]): string[] {
	const next = new Set(selected);
	if (next.has(name)) next.delete(name);
	else next.add(name);
	return order.filter((entry) => next.has(entry));
}

export interface ScopedValue {
	/** Value pi would use: global merged with the project file. */
	effective: unknown;
	/** Value the selected scope sets itself, undefined when it does not. */
	own: unknown;
	/** True when only the other scope sets the key, so editing here overrides it. */
	inherited: boolean;
}

export function scopedValue(
	global: JsonRecord,
	project: JsonRecord,
	scope: "global" | "project",
	path: string,
): ScopedValue {
	const own = readPath(scope === "global" ? global : project, path);
	const effective = readPath(mergeSettings(global, project), path);
	return { effective, own, inherited: own === undefined && effective !== undefined };
}

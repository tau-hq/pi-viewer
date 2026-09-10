import type { ModelInfo } from "@pi-tau/shared";

/** How pi writes an entry of `enabledModels` when its own selector persists one. */
export function modelKey(model: { provider: string; id: string }): string {
	return `${model.provider}/${model.id}`;
}

/** `enabledModels` of a settings document; anything else in the file is left alone. */
export function parseEnabledModels(content: string): string[] {
	if (content.trim().length === 0) return [];
	try {
		const parsed = JSON.parse(content) as unknown;
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
		const value = (parsed as Record<string, unknown>).enabledModels;
		return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
	} catch {
		return [];
	}
}

/** Add a key at the end or remove it, keeping the order of the rest. */
export function toggleEntry(entries: readonly string[], key: string): string[] {
	return entries.includes(key) ? entries.filter((entry) => entry !== key) : [...entries, key];
}

/** Move one entry by `delta` positions; out-of-range moves are ignored. */
export function moveEntry(entries: readonly string[], index: number, delta: number): string[] {
	const target = index + delta;
	if (index < 0 || index >= entries.length || target < 0 || target >= entries.length) return [...entries];
	const next = [...entries];
	const [moved] = next.splice(index, 1);
	if (moved !== undefined) next.splice(target, 0, moved);
	return next;
}

/**
 * Value for the settings patch. pi drops the key when nothing or everything is selected, so
 * the quick switch offers the full catalog again; `null` tells the host to delete it.
 */
export function patchValue(entries: readonly string[], catalog: readonly ModelInfo[]): string[] | null {
	if (entries.length === 0) return null;
	const keys = catalog.map(modelKey);
	if (keys.length > 0 && keys.every((key) => entries.includes(key)) && entries.length === keys.length) return null;
	return [...entries];
}

export interface ScopedModelRow {
	key: string;
	/** Undefined for an entry the catalog does not know (a stale id or one of pi's glob patterns). */
	model: ModelInfo | undefined;
	selected: boolean;
	/** Position in `enabledModels`, or -1 when the row is not selected. */
	index: number;
}

/** Selected entries in their configured order first, then the rest of the catalog. */
export function scopedModelRows(entries: readonly string[], catalog: readonly ModelInfo[]): ScopedModelRow[] {
	const byKey = new Map(catalog.map((model) => [modelKey(model), model] as const));
	const rows: ScopedModelRow[] = entries.map((key, index) => ({
		key,
		model: byKey.get(key),
		selected: true,
		index,
	}));
	for (const model of catalog) {
		const key = modelKey(model);
		if (!entries.includes(key)) rows.push({ key, model, selected: false, index: -1 });
	}
	return rows;
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type JsonObject = Record<string, unknown>;

export function readJsonObject(path: string): JsonObject {
	if (!existsSync(path)) return {};
	const text = readFileSync(path, "utf8").trim();
	if (text.length === 0) return {};
	const value = JSON.parse(text) as unknown;
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`${path} does not contain a JSON object`);
	return value as JsonObject;
}

function isPlainObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep merge; a null value deletes the key, arrays replace. */
export function mergeJson(base: JsonObject, patch: JsonObject): JsonObject {
	const out: JsonObject = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		if (value === null) delete out[key];
		else if (isPlainObject(value) && isPlainObject(out[key])) out[key] = mergeJson(out[key] as JsonObject, value);
		else out[key] = value;
	}
	return out;
}

/** Read-modify-write of a JSON object file, preserving keys the caller does not touch. */
export function patchJsonFile(path: string, patch: JsonObject): JsonObject {
	const merged = mergeJson(readJsonObject(path), patch);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	return merged;
}

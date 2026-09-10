import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeJson, patchJsonFile, readJsonObject } from "../src/json-file.js";

describe("json-file", () => {
	it("merges deeply, replaces arrays and deletes on null", () => {
		const base = { a: 1, nested: { keep: true, drop: "x", deep: { n: 1 } }, list: [1, 2] };
		const out = mergeJson(base, { a: 2, nested: { drop: null, deep: { m: 2 } }, list: [3] });
		expect(out).toEqual({ a: 2, nested: { keep: true, deep: { n: 1, m: 2 } }, list: [3] });
	});

	it("reads a missing or empty file as an empty object and rejects non-objects", () => {
		const dir = mkdtempSync(join(tmpdir(), "tau-json-"));
		expect(readJsonObject(join(dir, "nope.json"))).toEqual({});
		const empty = join(dir, "empty.json");
		writeFileSync(empty, "  \n");
		expect(readJsonObject(empty)).toEqual({});
		const arr = join(dir, "arr.json");
		writeFileSync(arr, "[1,2]");
		expect(() => readJsonObject(arr)).toThrow(/JSON object/);
	});

	it("keeps untouched keys when patching a file and creates missing directories", () => {
		const dir = mkdtempSync(join(tmpdir(), "tau-json-"));
		const file = join(dir, "deep", "settings.json");
		patchJsonFile(file, { theme: "dark", compaction: { enabled: true } });
		patchJsonFile(file, { compaction: { enabled: false }, extra: 1 });
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ theme: "dark", compaction: { enabled: false }, extra: 1 });
		expect(readFileSync(file, "utf8").endsWith("\n")).toBe(true);
	});
});

import type { ModelInfo } from "@pi-tau/shared";
import { describe, expect, it } from "vitest";
import { modelKey, moveEntry, parseEnabledModels, patchValue, scopedModelRows, toggleEntry } from "./scoped-models";

function model(provider: string, id: string): ModelInfo {
	return { provider, id, name: id, reasoning: false, input: ["text"], contextWindow: 1000, maxTokens: 100 };
}

const catalog = [model("nebius", "glm"), model("vendor", "opus")];

describe("parseEnabledModels", () => {
	it("reads the array and ignores anything else in the file", () => {
		expect(parseEnabledModels('{"theme":"dark","enabledModels":["a/b","c/d"]}')).toEqual(["a/b", "c/d"]);
	});
	it("is empty for a missing key, broken JSON or a non-object file", () => {
		expect(parseEnabledModels("")).toEqual([]);
		expect(parseEnabledModels("{ broken")).toEqual([]);
		expect(parseEnabledModels("[1,2]")).toEqual([]);
		expect(parseEnabledModels('{"enabledModels":[1,"a/b"]}')).toEqual(["a/b"]);
	});
});

describe("toggleEntry and moveEntry", () => {
	it("appends, removes and keeps the order", () => {
		expect(toggleEntry(["a", "b"], "c")).toEqual(["a", "b", "c"]);
		expect(toggleEntry(["a", "b", "c"], "b")).toEqual(["a", "c"]);
	});
	it("moves within the list and ignores moves off either end", () => {
		expect(moveEntry(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
		expect(moveEntry(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
		expect(moveEntry(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
	});
});

describe("patchValue", () => {
	it("deletes the key when nothing or everything is selected", () => {
		expect(patchValue([], catalog)).toBeNull();
		expect(patchValue(["nebius/glm", "vendor/opus"], catalog)).toBeNull();
	});
	it("keeps a real selection in its order", () => {
		expect(patchValue(["vendor/opus"], catalog)).toEqual(["vendor/opus"]);
	});
	it("keeps entries the catalog does not know", () => {
		expect(patchValue(["nebius/glm", "vendor/opus", "gone/model"], catalog)).toEqual([
			"nebius/glm",
			"vendor/opus",
			"gone/model",
		]);
	});
});

describe("scopedModelRows", () => {
	it("lists the selection in order, then the rest of the catalog", () => {
		const rows = scopedModelRows(["vendor/opus", "gone/model"], catalog);
		expect(rows.map((row) => `${row.key}:${row.selected}:${row.index}`)).toEqual([
			"vendor/opus:true:0",
			"gone/model:true:1",
			"nebius/glm:false:-1",
		]);
		expect(rows[1]?.model).toBeUndefined();
		expect(rows[2]?.model?.id).toBe("glm");
	});
	it("uses pi's provider/id key", () => {
		expect(modelKey(catalog[0] as ModelInfo)).toBe("nebius/glm");
	});
});

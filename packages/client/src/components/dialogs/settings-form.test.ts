import { describe, expect, it } from "vitest";
import {
	asRows,
	buildPatch,
	mergeSettings,
	parseSettings,
	readPath,
	rowsToRecord,
	scopedValue,
	toggleName,
} from "./settings-form";

describe("parseSettings", () => {
	it("returns an empty object for blank, broken or non-object JSON", () => {
		expect(parseSettings("")).toEqual({});
		expect(parseSettings("{ broken")).toEqual({});
		expect(parseSettings("[1,2]")).toEqual({});
		expect(parseSettings('{"a":1}')).toEqual({ a: 1 });
	});
});

describe("mergeSettings", () => {
	it("merges objects deeply and replaces everything else", () => {
		const merged = mergeSettings(
			{ compaction: { enabled: true, reserveTokens: 100 }, enabledModels: ["a"], transport: "auto" },
			{ compaction: { reserveTokens: 200 }, enabledModels: ["b"] },
		);
		expect(merged).toEqual({
			compaction: { enabled: true, reserveTokens: 200 },
			enabledModels: ["b"],
			transport: "auto",
		});
	});
});

describe("readPath", () => {
	it("walks dotted paths and stops at missing steps", () => {
		const settings = { markdown: { mermaid: "final" }, retry: { enabled: false } };
		expect(readPath(settings, "markdown.mermaid")).toBe("final");
		expect(readPath(settings, "retry.enabled")).toBe(false);
		expect(readPath(settings, "retry.maxRetries")).toBeUndefined();
		expect(readPath(settings, "nope.deeper")).toBeUndefined();
	});
});

describe("buildPatch", () => {
	it("nests dotted paths and keeps null as a delete request", () => {
		expect(
			buildPatch({
				"compaction.enabled": true,
				"compaction.reserveTokens": null,
				showCacheMissNotices: false,
			}),
		).toEqual({ compaction: { enabled: true, reserveTokens: null }, showCacheMissNotices: false });
	});
});

describe("scopedValue", () => {
	const global = { showCacheMissNotices: true, compaction: { enabled: false } };
	const project = { compaction: { enabled: true } };

	it("reports the effective value and where it comes from", () => {
		const cache = scopedValue(global, project, "project", "showCacheMissNotices");
		expect(cache).toEqual({ effective: true, own: undefined, inherited: true });
		const compaction = scopedValue(global, project, "project", "compaction.enabled");
		expect(compaction).toEqual({ effective: true, own: true, inherited: false });
		const missing = scopedValue(global, project, "global", "transport");
		expect(missing).toEqual({ effective: undefined, own: undefined, inherited: false });
	});
});

describe("model rows", () => {
	it("round-trips a record and drops empty keys", () => {
		expect(asRows({ "a/b": "high", "c/d": "off", bad: 3 })).toEqual([
			{ key: "a/b", value: "high" },
			{ key: "c/d", value: "off" },
		]);
		expect(
			rowsToRecord([
				{ key: " a/b ", value: "low" },
				{ key: "", value: "high" },
			]),
		).toEqual({ "a/b": "low" });
		expect(rowsToRecord([])).toBeNull();
		expect(asRows("nope")).toEqual([]);
	});
});

describe("toggleName", () => {
	it("adds and removes while keeping the given order", () => {
		const order = ["read", "bash", "edit"];
		expect(toggleName(["edit"], "read", order)).toEqual(["read", "edit"]);
		expect(toggleName(["read", "edit"], "read", order)).toEqual(["edit"]);
	});
});

import { describe, expect, it } from "vitest";
import { isBlank, jsonSyntaxError } from "./json";

describe("jsonSyntaxError", () => {
	it("accepts valid JSON documents", () => {
		expect(jsonSyntaxError("{}")).toBeUndefined();
		expect(jsonSyntaxError('{"a": [1, 2, {"b": null}]}')).toBeUndefined();
	});

	it("reports the parser message for broken JSON", () => {
		expect(jsonSyntaxError('{"a": }')).toMatch(/JSON/i);
		expect(jsonSyntaxError("")).toBeDefined();
	});
});

describe("isBlank", () => {
	it("treats whitespace as empty", () => {
		expect(isBlank("  \n\t")).toBe(true);
		expect(isBlank("{}")).toBe(false);
	});
});

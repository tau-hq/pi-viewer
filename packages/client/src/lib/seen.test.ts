import { describe, expect, it } from "vitest";
import { parseSeen, pruneSeen } from "./seen";

describe("parseSeen", () => {
	it("reads a map of numbers", () => {
		expect(parseSeen('{"a":1,"b":2}')).toEqual({ a: 1, b: 2 });
	});

	it("yields no marks for a missing, broken or wrongly shaped entry", () => {
		expect(parseSeen(null)).toEqual({});
		expect(parseSeen("not json")).toEqual({});
		expect(parseSeen("[1,2]")).toEqual({});
		expect(parseSeen("42")).toEqual({});
	});

	it("drops values that are not finite numbers", () => {
		expect(parseSeen('{"a":1,"b":"2000","c":null,"d":1e999}')).toEqual({ a: 1 });
	});
});

describe("pruneSeen", () => {
	it("keeps a map that is within the limit untouched", () => {
		const map = { a: 1, b: 2 };
		expect(pruneSeen(map, 2)).toBe(map);
	});

	it("keeps the most recently seen entries", () => {
		expect(pruneSeen({ a: 10, b: 30, c: 20 }, 2)).toEqual({ b: 30, c: 20 });
	});

	it("prunes to the default limit", () => {
		const map: Record<string, number> = {};
		for (let i = 0; i < 250; i++) map[`s${i}`] = i;
		const pruned = pruneSeen(map);
		expect(Object.keys(pruned)).toHaveLength(200);
		expect(pruned.s249).toBe(249);
		expect(pruned.s49).toBeUndefined();
	});
});

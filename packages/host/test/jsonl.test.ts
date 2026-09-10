import { describe, expect, it } from "vitest";
import { JsonLineSplitter } from "../src/pi/jsonl.js";

describe("JsonLineSplitter", () => {
	it("splits on LF only and keeps U+2028 inside strings", () => {
		const s = new JsonLineSplitter();
		const line = JSON.stringify({ text: "a b c" });
		expect(s.push(`${line}\n`)).toEqual([line]);
		expect(JSON.parse(line).text).toBe("a b c");
	});

	it("handles chunks that end mid-line and strips a trailing CR", () => {
		const s = new JsonLineSplitter();
		expect(s.push('{"a":')).toEqual([]);
		expect(s.push('1}\r\n{"b":2}\n{"c"')).toEqual(['{"a":1}', '{"b":2}']);
		expect(s.pending).toBe('{"c"');
		expect(s.push(":3}\n\n")).toEqual(['{"c":3}']);
	});
});

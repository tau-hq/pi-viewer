import { describe, expect, it } from "vitest";
import { recentlyShown } from "./TranscriptStack";

describe("recentlyShown", () => {
	it("puts the session being shown last and keeps the rest in order", () => {
		expect(recentlyShown(["a"], "b", 3)).toEqual(["a", "b"]);
		expect(recentlyShown(["a", "b"], "a", 3)).toEqual(["b", "a"]);
	});

	it("drops the one used longest ago once the limit is reached", () => {
		expect(recentlyShown(["a", "b", "c"], "d", 3)).toEqual(["b", "c", "d"]);
	});

	it("never lists a session twice", () => {
		expect(recentlyShown(["a", "b", "c"], "b", 3)).toEqual(["a", "c", "b"]);
	});

	it("keeps only the current one when nothing is to be kept", () => {
		expect(recentlyShown(["a", "b"], "c", 1)).toEqual(["c"]);
	});
});

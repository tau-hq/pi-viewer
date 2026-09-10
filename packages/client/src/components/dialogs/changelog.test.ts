import { describe, expect, it } from "vitest";
import { sliceChangelog } from "./changelog";

const log = [
	"# Changelog",
	"",
	"## [2.0.0] - 2026-09-05",
	"- newest",
	"",
	"## [1.9.0] - 2026-09-04",
	"- middle",
	"",
	"## [1.8.0] - 2026-09-03",
	"- oldest",
	"",
].join("\n");

describe("sliceChangelog", () => {
	it("counts every release and keeps the whole text when it fits", () => {
		const slice = sliceChangelog(log, 10);
		expect(slice).toMatchObject({ shown: 3, total: 3 });
		expect(slice.markdown).toBe(log);
	});

	it("keeps the preamble and cuts after the requested number of releases", () => {
		const slice = sliceChangelog(log, 2);
		expect(slice).toMatchObject({ shown: 2, total: 3 });
		expect(slice.markdown).toContain("# Changelog");
		expect(slice.markdown).toContain("## [1.9.0] - 2026-09-04");
		expect(slice.markdown).not.toContain("1.8.0");
	});

	it("ignores headings inside fenced code blocks", () => {
		const withFence = ["## [1.0.0] - 2026-01-01", "", "```md", "## not a release", "```", "", "- text"].join("\n");
		expect(sliceChangelog(withFence, 5).total).toBe(1);
	});

	it("handles a changelog without any release heading", () => {
		expect(sliceChangelog("just text", 3)).toEqual({ markdown: "just text", shown: 0, total: 0 });
	});
});

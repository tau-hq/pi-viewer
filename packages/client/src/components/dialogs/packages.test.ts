import { describe, expect, it } from "vitest";
import { countEnabled, looksLikePackageSource, packagesOfScope, parsePackages, parseResources } from "./packages";

describe("parsePackages", () => {
	it("keeps well formed entries and drops the rest", () => {
		expect(
			parsePackages([
				{ source: "npm:a", scope: "user", filtered: false, installedPath: "/x" },
				{ source: "npm:b", scope: "project", filtered: true },
				{ source: "npm:c", scope: "nonsense" },
				{ scope: "user" },
				"junk",
			]),
		).toEqual([
			{ source: "npm:a", scope: "user", filtered: false, installed: true, installedPath: "/x" },
			{ source: "npm:b", scope: "project", filtered: true, installed: false },
		]);
	});

	it("accepts the wrapped shape and unknown data", () => {
		expect(parsePackages({ packages: [{ source: "npm:a", scope: "user" }] })).toEqual([
			{ source: "npm:a", scope: "user", filtered: false, installed: false },
		]);
		expect(parsePackages(undefined)).toEqual([]);
	});

	it("takes the host's installed flag, and falls back to the install path", () => {
		expect(parsePackages([{ source: "npm:a", scope: "user", installed: true }])[0]?.installed).toBe(true);
		expect(parsePackages([{ source: "npm:a", scope: "user", installedPath: "/x" }])[0]?.installed).toBe(true);
		expect(parsePackages([{ source: "npm:a", scope: "user", installed: false }])[0]?.installed).toBe(false);
	});
});

describe("parseResources", () => {
	it("fills the four groups and defaults missing fields", () => {
		const overview = parseResources({
			skills: [{ path: "/p/s.md", name: "s", enabled: false, source: "npm:x", scope: "project", origin: "package" }],
			prompts: [{ path: "/p/p.md" }],
			extensions: "nope",
		});
		expect(overview.skills).toEqual([
			{
				kind: "skills",
				path: "/p/s.md",
				name: "s",
				enabled: false,
				source: "npm:x",
				scope: "project",
				origin: "package",
			},
		]);
		expect(overview.prompts[0]).toEqual({
			kind: "prompts",
			path: "/p/p.md",
			name: "/p/p.md",
			enabled: true,
			source: "",
			scope: "user",
			origin: "top-level",
		});
		expect(overview.extensions).toEqual([]);
		expect(overview.themes).toEqual([]);
		expect(countEnabled(overview.prompts)).toBe(1);
		expect(countEnabled(overview.skills)).toBe(0);
	});
});

describe("packagesOfScope", () => {
	it("filters by scope and sorts by source", () => {
		const entries = parsePackages([
			{ source: "npm:b", scope: "user" },
			{ source: "npm:a", scope: "user" },
			{ source: "npm:c", scope: "project" },
		]);
		expect(packagesOfScope(entries, "user").map((e) => e.source)).toEqual(["npm:a", "npm:b"]);
		expect(packagesOfScope(entries, "project").map((e) => e.source)).toEqual(["npm:c"]);
	});
});

describe("looksLikePackageSource", () => {
	it("accepts what pi can parse", () => {
		for (const source of [
			"npm:@scope/pkg@1.2.3",
			"git:github.com/user/repo@main",
			"https://example.com/pkg.tgz",
			"git@github.com:user/repo.git",
			"/srv/pi/extensions",
			"~/pkgs/mine",
			"./local",
			"C:\\pkgs\\mine",
		]) {
			expect(looksLikePackageSource(source), source).toBe(true);
		}
	});

	it("refuses what pi would treat as a missing local path", () => {
		for (const source of ["", "   ", "npm:", "git:github.com/user", "nonsense", "two words", "pkg@1.0.0"]) {
			expect(looksLikePackageSource(source), source).toBe(false);
		}
	});
});

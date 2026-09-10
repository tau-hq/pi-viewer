import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { searchFiles } from "../src/file-search.js";

function fixture(): string {
	const dir = mkdtempSync(join(tmpdir(), "tau-files-"));
	mkdirSync(join(dir, "packages", "client", "src"), { recursive: true });
	mkdirSync(join(dir, "node_modules", "junk"), { recursive: true });
	writeFileSync(join(dir, "packages", "client", "src", "protocol.ts"), "");
	writeFileSync(join(dir, "packages", "client", "src", "App.tsx"), "");
	writeFileSync(join(dir, "README.md"), "");
	writeFileSync(join(dir, "node_modules", "junk", "protocol.ts"), "");
	writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
	return dir;
}

describe("searchFiles", () => {
	it("finds files by subsequence and prefers the shorter path", async () => {
		const dir = fixture();
		const files = await searchFiles(dir, "proto");
		expect(files.length).toBeGreaterThan(0);
		expect(files[0]?.path).toBe(join("packages", "client", "src", "protocol.ts"));
		// node_modules is ignored (by fd through .gitignore, by the walker through its skip list)
		expect(files.some((f) => f.path.includes("node_modules"))).toBe(false);
	});

	it("returns nothing for a query that does not match and honours the limit", async () => {
		const dir = fixture();
		expect(await searchFiles(dir, "zzzznope")).toEqual([]);
		expect((await searchFiles(dir, "", 2)).length).toBe(2);
	});

	it("marks directories", async () => {
		const dir = fixture();
		const files = await searchFiles(dir, "client");
		expect(files.some((f) => f.isDirectory && f.path.endsWith("/"))).toBe(true);
	});
});

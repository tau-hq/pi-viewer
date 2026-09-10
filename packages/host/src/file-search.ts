import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import type { FileMatch } from "@pi-tau/shared";
import { createLogger } from "./logger.js";

const log = createLogger("files");
const run = promisify(execFile);
const SKIP = new Set(["node_modules", ".git", "dist", "target", ".next", ".venv", "__pycache__", ".cache"]);
const WALK_LIMIT = 20_000;

/**
 * Rank a path against a query, lower is better. A hit in the file name beats a hit
 * anywhere in the path, an exact substring beats a scattered subsequence, and among
 * equals the shorter path wins - which is what a fuzzy file picker should feel like.
 */
function score(path: string, query: string): number | undefined {
	const lengthTerm = path.length / 100;
	if (query.length === 0) return lengthTerm;
	const haystack = path.toLowerCase();
	const needle = query.toLowerCase();
	const name = haystack.slice(haystack.lastIndexOf(sep) + 1);

	const inName = name.indexOf(needle);
	if (inName !== -1) return (inName === 0 ? 0 : 10) + inName / 100 + lengthTerm;

	const inPath = haystack.indexOf(needle);
	if (inPath !== -1) return 100 + inPath / 100 + lengthTerm;

	// Scattered subsequence: rank by how tightly the characters sit together.
	let index = 0;
	let first = -1;
	for (const char of needle) {
		const found = haystack.indexOf(char, index);
		if (found === -1) return undefined;
		if (first === -1) first = found;
		index = found + 1;
	}
	const nameStart = haystack.lastIndexOf(sep) + 1;
	return 1000 + (index - first) + (first >= nameStart ? 0 : 50) + lengthTerm;
}

/** Depth-first walk used when fd is not installed; bounded so a huge tree cannot stall the host. */
async function walk(root: string): Promise<{ path: string; isDirectory: boolean }[]> {
	const out: { path: string; isDirectory: boolean }[] = [];
	const stack = [root];
	while (stack.length > 0 && out.length < WALK_LIMIT) {
		const dir = stack.pop() as string;
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
			const full = join(dir, entry.name);
			const rel = relative(root, full);
			if (entry.isDirectory()) {
				out.push({ path: `${rel}/`, isDirectory: true });
				stack.push(full);
			} else out.push({ path: rel, isDirectory: false });
		}
	}
	return out;
}

/**
 * Project files matching `query`, newest interface for the composer's `@` mentions.
 * Uses fd when available because it honours .gitignore; otherwise a bounded walk.
 */
export async function searchFiles(cwd: string, query: string, limit = 20): Promise<FileMatch[]> {
	let entries: { path: string; isDirectory: boolean }[] = [];
	try {
		// --no-require-git makes fd honour .gitignore outside a repository too; the explicit
		// excludes match the fallback walker so both paths behave the same.
		const args = [".", "--strip-cwd-prefix", "--hidden", "--no-require-git", "--color", "never"];
		for (const skip of SKIP) args.push("--exclude", skip);
		args.push("--exclude", ".git");
		const { stdout } = await run("fd", args, {
			cwd,
			timeout: 4_000,
			maxBuffer: 8 * 1024 * 1024,
		});
		entries = stdout
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => ({ path: line, isDirectory: line.endsWith("/") }));
	} catch (error) {
		log.debug(`fd unavailable, walking instead: ${(error as Error).message}`);
		entries = await walk(cwd);
	}
	const scored: { entry: { path: string; isDirectory: boolean }; score: number }[] = [];
	for (const entry of entries) {
		const value = score(entry.path.replace(/\/$/, ""), query);
		if (value !== undefined) scored.push({ entry, score: value });
	}
	scored.sort((a, b) => a.score - b.score || a.entry.path.localeCompare(b.entry.path));
	return scored.slice(0, limit).map(({ entry }) => ({ path: entry.path, isDirectory: entry.isDirectory }));
}

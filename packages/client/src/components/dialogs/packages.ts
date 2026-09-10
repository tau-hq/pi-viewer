import type { PackageEntry, ResourceEntry, ResourceKind, ResourceOverview } from "@pi-tau/shared";
import { asRecord, pickArray } from "@/lib/result-data";

export const RESOURCE_KINDS: readonly ResourceKind[] = ["extensions", "skills", "prompts", "themes"];

/** Package scopes in display order; pi calls the global one "user". */
export const PACKAGE_SCOPES: readonly ("user" | "project")[] = ["user", "project"];

function isScope(value: unknown): value is "user" | "project" {
	return value === "user" || value === "project";
}

/** `packages.list` and friends answer with the full list; unknown shapes become an empty list. */
export function parsePackages(data: unknown): PackageEntry[] {
	return pickArray<unknown>(data, "packages").flatMap((raw) => {
		const record = asRecord(raw);
		if (!record || typeof record.source !== "string" || !isScope(record.scope)) return [];
		const entry: PackageEntry = { source: record.source, scope: record.scope, filtered: record.filtered === true };
		if (typeof record.installedPath === "string") entry.installedPath = record.installedPath;
		return [entry];
	});
}

function parseResource(kind: ResourceKind, raw: unknown): ResourceEntry[] {
	const record = asRecord(raw);
	if (!record || typeof record.path !== "string") return [];
	return [
		{
			kind,
			path: record.path,
			name: typeof record.name === "string" ? record.name : record.path,
			enabled: record.enabled !== false,
			source: typeof record.source === "string" ? record.source : "",
			scope: isScope(record.scope) ? record.scope : "user",
			origin: record.origin === "package" ? "package" : "top-level",
		},
	];
}

export function parseResources(data: unknown): ResourceOverview {
	const record = asRecord(data) ?? {};
	const overview: ResourceOverview = { extensions: [], skills: [], prompts: [], themes: [] };
	for (const kind of RESOURCE_KINDS) {
		const list = Array.isArray(record[kind]) ? (record[kind] as unknown[]) : [];
		overview[kind] = list.flatMap((raw) => parseResource(kind, raw));
	}
	return overview;
}

export function countEnabled(entries: readonly ResourceEntry[]): number {
	return entries.filter((entry) => entry.enabled).length;
}

/** Rows of one scope, sorted by source, so the table groups without a second pass. */
export function packagesOfScope(entries: readonly PackageEntry[], scope: "user" | "project"): PackageEntry[] {
	return entries.filter((entry) => entry.scope === scope).sort((a, b) => a.source.localeCompare(b.source));
}

/**
 * Cheap shape check for a package source, mirroring pi's own parser: an `npm:` spec, a git
 * source, an http(s)/ssh URL or a path. Anything else pi would treat as a local path that
 * does not exist, so it is refused here instead of after a failed npm run.
 */
export function looksLikePackageSource(source: string): boolean {
	const value = source.trim();
	if (value.length === 0 || /\s/.test(value)) return false;
	if (value.startsWith("npm:")) return value.length > "npm:".length;
	if (value.startsWith("git:")) return /^git:[^/]+\/[^/]+\/.+/.test(value);
	if (/^(https?|ssh|git):\/\//.test(value) || value.startsWith("git@")) return true;
	// Local paths: absolute, home relative, explicitly relative, or a Windows drive.
	return /^([a-zA-Z]:[\\/]|[\\/]|~[\\/]|\.{1,2}[\\/])/.test(value);
}

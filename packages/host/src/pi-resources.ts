/**
 * Packages and resources through pi's SDK: the GUI equivalent of
 * `pi install/remove/update` and `pi config`. Reading uses pi's resolver so the
 * result matches what pi would load; writing goes to the settings files directly,
 * so the host does not depend on internals of SettingsManager.
 */
import { basename, resolve } from "node:path";
import {
	DefaultPackageManager,
	getAgentDir,
	type ResolvedResource,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { PackageEntry, ResourceEntry, ResourceKind, ResourceOverview } from "@pi-tau/shared";
import { type JsonObject, patchJsonFile, readJsonObject } from "./json-file.js";
import { createLogger } from "./logger.js";

const log = createLogger("resources");
const KINDS: ResourceKind[] = ["extensions", "skills", "prompts", "themes"];

function packageManager(cwd: string): DefaultPackageManager {
	const settingsManager = SettingsManager.create(cwd, getAgentDir());
	return new DefaultPackageManager({ cwd, agentDir: getAgentDir(), settingsManager });
}

export function listPackages(cwd: string): PackageEntry[] {
	return packageManager(cwd)
		.listConfiguredPackages()
		.map((p) => {
			const entry: PackageEntry = {
				source: p.source,
				scope: p.scope,
				filtered: p.filtered,
				installed: p.installedPath !== undefined,
			};
			if (p.installedPath !== undefined) entry.installedPath = p.installedPath;
			return entry;
		});
}

export async function installPackage(cwd: string, source: string, scope: "user" | "project"): Promise<PackageEntry[]> {
	log.info(`install ${source} (${scope})`);
	await packageManager(cwd).installAndPersist(source, { local: scope === "project" });
	return listPackages(cwd);
}

export async function removePackage(cwd: string, source: string, scope: "user" | "project"): Promise<PackageEntry[]> {
	log.info(`remove ${source} (${scope})`);
	await packageManager(cwd).removeAndPersist(source, { local: scope === "project" });
	return listPackages(cwd);
}

export async function updatePackages(cwd: string, source?: string): Promise<PackageEntry[]> {
	log.info(`update ${source ?? "all packages"}`);
	await packageManager(cwd).update(source);
	return listPackages(cwd);
}

function toEntry(kind: ResourceKind, resource: ResolvedResource): ResourceEntry {
	return {
		kind,
		path: resource.path,
		name: basename(resource.path).replace(/\.(ts|js|md|json)$/, ""),
		enabled: resource.enabled,
		source: resource.metadata.source,
		scope: resource.metadata.scope === "project" ? "project" : "user",
		origin: resource.metadata.origin,
	};
}

/** Everything pi would discover in `cwd`, with its current enabled flag. */
export async function listResources(cwd: string): Promise<ResourceOverview> {
	// "skip" keeps listing side-effect free: a missing package is not installed here.
	const resolved = await packageManager(cwd).resolve(async () => "skip");
	const overview: ResourceOverview = { extensions: [], skills: [], prompts: [], themes: [] };
	for (const kind of KINDS) overview[kind] = resolved[kind].map((r) => toEntry(kind, r));
	return overview;
}

/**
 * Enable or disable one discovered resource by writing a force-exclude entry
 * (`-<path>`) into the matching settings array, which is pi's own path syntax.
 */
export async function setResourceEnabled(
	cwd: string,
	settingsPath: string,
	kind: ResourceKind,
	path: string,
	enabled: boolean,
): Promise<ResourceOverview> {
	const target = resolve(path);
	const current = readJsonObject(settingsPath);
	const list = Array.isArray(current[kind]) ? ([...(current[kind] as unknown[])] as string[]) : [];
	const marksTarget = (entry: string): boolean =>
		(entry.startsWith("-") || entry.startsWith("!")) && resolve(entry.slice(1)) === target;
	const next = list.filter((entry) => typeof entry === "string" && !marksTarget(entry));
	if (!enabled) next.push(`-${target}`);
	// An empty array carries no information; remove the key so settings files stay tidy.
	patchJsonFile(settingsPath, { [kind]: next.length > 0 ? next : null } as JsonObject);
	log.info(`${enabled ? "enable" : "disable"} ${kind} ${target} in ${settingsPath}`);
	return listResources(cwd);
}

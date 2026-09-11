import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { GroupsState, SessionGroup } from "@pi-tau/shared";
import { createLogger } from "./logger.js";

const log = createLogger("groups");
const MAX_NAME = 60;

interface GroupFile {
	version: 1;
	groups: SessionGroup[];
	/** Session file path to group id. Paths of deleted sessions are pruned on write. */
	assignments: Record<string, string>;
	/**
	 * Working directory to the name the user gave that project group. Kept apart from the
	 * groups: a project group is not an object the user created, it is a directory that has
	 * sessions in it, and it must keep its name when the last of them is deleted and a new
	 * one appears later.
	 */
	projectNames: Record<string, string>;
}

const EMPTY: GroupFile = { version: 1, groups: [], assignments: {}, projectNames: {} };

/** Tau's own data directory: never pi's, so nothing here can disturb a session. */
export function tauDataDir(): string {
	return process.env.TAU_DATA_DIR ?? join(homedir(), ".tau");
}

function file(): string {
	return join(tauDataDir(), "groups.json");
}

function read(): GroupFile {
	const path = file();
	if (!existsSync(path)) return { ...EMPTY, groups: [], assignments: {}, projectNames: {} };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<GroupFile>;
		const groups = Array.isArray(parsed.groups) ? parsed.groups.filter(isGroup) : [];
		const assignments: Record<string, string> = {};
		for (const [key, value] of Object.entries(parsed.assignments ?? {})) {
			if (typeof value === "string" && groups.some((g) => g.id === value)) assignments[key] = value;
		}
		const projectNames: Record<string, string> = {};
		for (const [key, value] of Object.entries(parsed.projectNames ?? {})) {
			if (typeof value === "string" && value.length > 0) projectNames[key] = value;
		}
		return { version: 1, groups: [...groups].sort((a, b) => a.order - b.order), assignments, projectNames };
	} catch (error) {
		log.warn(`${path} is unreadable, starting empty: ${(error as Error).message}`);
		return { ...EMPTY, groups: [], assignments: {}, projectNames: {} };
	}
}

function isGroup(value: unknown): value is SessionGroup {
	const group = value as SessionGroup;
	return typeof group?.id === "string" && typeof group.name === "string" && typeof group.order === "number";
}

function write(state: GroupFile): void {
	const path = file();
	mkdirSync(dirname(path), { recursive: true });
	// Write and rename so a crash cannot leave half a file behind.
	const temporary = `${path}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	renameSync(temporary, path);
}

function normalizeName(name: string): string {
	const trimmed = name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME);
	if (trimmed.length === 0) throw new Error("a group needs a name");
	return trimmed;
}

function state(file: GroupFile): GroupsState {
	return { groups: file.groups, projectNames: file.projectNames };
}

export function listGroups(): GroupsState {
	return state(read());
}

/** Name a project group, or drop the name with `name: null` so the folder name shows again. */
export function setProjectName(cwd: string, name: string | null): GroupsState {
	const file = read();
	const key = resolve(cwd);
	if (name === null) delete file.projectNames[key];
	else file.projectNames[key] = normalizeName(name);
	write(file);
	log.info(
		name === null ? `project ${key} uses its folder name again` : `project ${key} named "${file.projectNames[key]}"`,
	);
	return state(file);
}

/** Group id per session file path, for the session list. */
export function assignments(): Record<string, string> {
	return read().assignments;
}

export function createGroup(name: string): GroupsState {
	const file = read();
	const group: SessionGroup = {
		id: randomUUID(),
		name: normalizeName(name),
		order: file.groups.reduce((max, g) => Math.max(max, g.order), -1) + 1,
	};
	file.groups.push(group);
	write(file);
	log.info(`group "${group.name}" created`);
	return state(file);
}

export function renameGroup(id: string, name: string): GroupsState {
	const file = read();
	const group = file.groups.find((g) => g.id === id);
	if (!group) throw new Error("no such group");
	group.name = normalizeName(name);
	write(file);
	return state(file);
}

export function deleteGroup(id: string): GroupsState {
	const file = read();
	if (!file.groups.some((g) => g.id === id)) throw new Error("no such group");
	file.groups = file.groups.filter((g) => g.id !== id);
	for (const [path, groupId] of Object.entries(file.assignments)) {
		if (groupId === id) delete file.assignments[path];
	}
	write(file);
	log.info(`group ${id} deleted; its sessions fall back to their project`);
	return state(file);
}

export function assignSession(sessionPath: string, groupId: string | null): GroupsState {
	const file = read();
	const key = resolve(sessionPath);
	if (groupId === null) delete file.assignments[key];
	else {
		if (!file.groups.some((g) => g.id === groupId)) throw new Error("no such group");
		file.assignments[key] = groupId;
	}
	write(file);
	return state(file);
}

export function reorderGroups(ids: string[]): GroupsState {
	const file = read();
	const known = new Map(file.groups.map((g) => [g.id, g] as const));
	const ordered: SessionGroup[] = [];
	for (const id of ids) {
		const group = known.get(id);
		if (!group) continue;
		group.order = ordered.length;
		ordered.push(group);
		known.delete(id);
	}
	// Groups the caller did not mention keep their relative order, after the ones it did.
	for (const group of known.values()) {
		group.order = ordered.length;
		ordered.push(group);
	}
	file.groups = ordered;
	write(file);
	return state(file);
}

/** Drop assignments whose session file is gone, so the file cannot grow forever. */
export function pruneAssignments(existingPaths: Set<string>): void {
	const file = read();
	let changed = false;
	for (const path of Object.keys(file.assignments)) {
		if (existingPaths.has(path)) continue;
		delete file.assignments[path];
		changed = true;
	}
	if (changed) write(file);
}

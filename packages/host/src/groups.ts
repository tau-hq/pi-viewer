import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { SessionGroup } from "@pi-tau/shared";
import { createLogger } from "./logger.js";

const log = createLogger("groups");
const MAX_NAME = 60;

interface GroupFile {
	version: 1;
	groups: SessionGroup[];
	/** Session file path to group id. Paths of deleted sessions are pruned on write. */
	assignments: Record<string, string>;
}

const EMPTY: GroupFile = { version: 1, groups: [], assignments: {} };

/** Tau's own data directory: never pi's, so nothing here can disturb a session. */
export function tauDataDir(): string {
	return process.env.TAU_DATA_DIR ?? join(homedir(), ".tau");
}

function file(): string {
	return join(tauDataDir(), "groups.json");
}

function read(): GroupFile {
	const path = file();
	if (!existsSync(path)) return { ...EMPTY, groups: [], assignments: {} };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<GroupFile>;
		const groups = Array.isArray(parsed.groups) ? parsed.groups.filter(isGroup) : [];
		const assignments: Record<string, string> = {};
		for (const [key, value] of Object.entries(parsed.assignments ?? {})) {
			if (typeof value === "string" && groups.some((g) => g.id === value)) assignments[key] = value;
		}
		return { version: 1, groups: [...groups].sort((a, b) => a.order - b.order), assignments };
	} catch (error) {
		log.warn(`${path} is unreadable, starting empty: ${(error as Error).message}`);
		return { ...EMPTY, groups: [], assignments: {} };
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

export function listGroups(): SessionGroup[] {
	return read().groups;
}

/** Group id per session file path, for the session list. */
export function assignments(): Record<string, string> {
	return read().assignments;
}

export function createGroup(name: string): SessionGroup[] {
	const state = read();
	const group: SessionGroup = {
		id: randomUUID(),
		name: normalizeName(name),
		order: state.groups.reduce((max, g) => Math.max(max, g.order), -1) + 1,
	};
	state.groups.push(group);
	write(state);
	log.info(`group "${group.name}" created`);
	return state.groups;
}

export function renameGroup(id: string, name: string): SessionGroup[] {
	const state = read();
	const group = state.groups.find((g) => g.id === id);
	if (!group) throw new Error("no such group");
	group.name = normalizeName(name);
	write(state);
	return state.groups;
}

export function deleteGroup(id: string): SessionGroup[] {
	const state = read();
	if (!state.groups.some((g) => g.id === id)) throw new Error("no such group");
	state.groups = state.groups.filter((g) => g.id !== id);
	for (const [path, groupId] of Object.entries(state.assignments)) {
		if (groupId === id) delete state.assignments[path];
	}
	write(state);
	log.info(`group ${id} deleted; its sessions fall back to their project`);
	return state.groups;
}

export function assignSession(sessionPath: string, groupId: string | null): SessionGroup[] {
	const state = read();
	const key = resolve(sessionPath);
	if (groupId === null) delete state.assignments[key];
	else {
		if (!state.groups.some((g) => g.id === groupId)) throw new Error("no such group");
		state.assignments[key] = groupId;
	}
	write(state);
	return state.groups;
}

export function reorderGroups(ids: string[]): SessionGroup[] {
	const state = read();
	const known = new Map(state.groups.map((g) => [g.id, g] as const));
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
	state.groups = ordered;
	write(state);
	return state.groups;
}

/** Drop assignments whose session file is gone, so the file cannot grow forever. */
export function pruneAssignments(existingPaths: Set<string>): void {
	const state = read();
	let changed = false;
	for (const path of Object.keys(state.assignments)) {
		if (existingPaths.has(path)) continue;
		delete state.assignments[path];
		changed = true;
	}
	if (changed) write(state);
}

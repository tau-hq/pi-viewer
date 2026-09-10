import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type {
	ConfigDocument,
	ConfigFile,
	ConfigScope,
	HostCommand,
	HostEnvelope,
	HostInfo,
	ModelInfo,
	ProjectInfo,
	SessionCreateOptions,
	SessionSummary,
} from "@pi-tau/shared";
import { searchFiles } from "../file-search.js";
import { patchJsonFile } from "../json-file.js";
import { createLogger } from "../logger.js";
import {
	installPackage,
	listPackages,
	listResources,
	removePackage,
	setResourceEnabled,
	updatePackages,
} from "../pi-resources.js";
import {
	agentDir,
	defaultModelSpec,
	listAllSessions,
	listAvailableModels,
	listProviders,
	logout,
	piVersion,
	readChangelog,
	readSessionHeaderCwd,
	readTrust,
	sessionDirFor,
	writeTrust,
} from "../pi-sdk.js";
import { type TerminalOptions, Terminals } from "../server/terminals.js";
import { AuthFlows } from "./auth-flows.js";
import { TauSession } from "./tau-session.js";

const log = createLogger("registry");

export interface RegistryOptions {
	defaultCwd: string;
	idleTimeoutMs: number;
	/** Extra pi CLI arguments for every session (e.g. ["-e", extensionPath]). */
	piArgs: string[];
	hostVersion: string;
	/** Standalone pi executable; when unset the npm package runs under Node. */
	piBinary?: string;
	/** node-pty installation on disk, for hosts that cannot load the bundled module. */
	nodePtyPath?: string;
}

/**
 * Owns all running TauSessions and answers host-level commands. Emits
 * "sessions.changed" whenever the list clients see may have changed.
 */
export class SessionRegistry extends EventEmitter {
	private readonly sessions = new Map<string, TauSession>();
	private readonly starting = new Map<string, Promise<TauSession>>();
	readonly auth = new AuthFlows();
	readonly terminals: Terminals;

	constructor(private readonly options: RegistryOptions) {
		super();
		const terminalOptions: TerminalOptions = { piArgs: options.piArgs };
		if (options.piBinary) terminalOptions.piBinary = options.piBinary;
		if (options.nodePtyPath) terminalOptions.nodePtyPath = options.nodePtyPath;
		this.terminals = new Terminals(terminalOptions);
	}

	get(handle: string): TauSession | undefined {
		return this.sessions.get(handle);
	}

	all(): TauSession[] {
		return [...this.sessions.values()];
	}

	private piVersionCache: string | undefined;

	/** pi's version: from the SDK when running under Node, from `pi --version` for a standalone binary. */
	private resolvePiVersion(): string {
		if (this.piVersionCache) return this.piVersionCache;
		let version = piVersion;
		if (this.options.piBinary) {
			try {
				version =
					execFileSync(this.options.piBinary, ["--version"], { encoding: "utf8", timeout: 10_000 }).trim() || version;
			} catch (error) {
				log.warn(`pi --version failed: ${(error as Error).message}`);
			}
		}
		this.piVersionCache = version;
		return version;
	}

	hostInfo(): HostInfo {
		return {
			name: "Tau",
			version: this.options.hostVersion,
			piVersion: this.resolvePiVersion(),
			platform: process.platform,
			homeCwd: process.env.HOME ?? process.cwd(),
			defaultCwd: this.options.defaultCwd,
		};
	}

	/** `emit` delivers host-level envelopes (login prompts) to the client that issued the command. */
	async execute(command: HostCommand, emit: (envelope: HostEnvelope) => void = () => undefined): Promise<unknown> {
		switch (command.type) {
			case "host.info":
				return this.hostInfo();
			case "auth.providers":
				return listProviders();
			case "auth.login":
				return this.auth.start(command.providerId, command.method, emit);
			case "auth.answer":
				this.auth.answer(command.flowId, command.promptId, command.value);
				return null;
			case "auth.cancel":
				this.auth.cancel(command.flowId);
				return null;
			case "auth.logout":
				await logout(command.providerId);
				return null;
			case "sessions.import":
				return this.importSession(command.sourcePath, command.cwd);
			case "models.refresh":
				return listAvailableModels(true);
			case "pi.changelog":
				return readChangelog();
			case "packages.list":
				return listPackages(resolve(command.cwd ?? this.options.defaultCwd));
			case "packages.install":
				return installPackage(resolve(command.cwd ?? this.options.defaultCwd), command.source, command.scope);
			case "packages.remove":
				return removePackage(resolve(command.cwd ?? this.options.defaultCwd), command.source, command.scope);
			case "packages.update":
				return updatePackages(resolve(command.cwd ?? this.options.defaultCwd), command.source);
			case "resources.list":
				return listResources(resolve(command.cwd ?? this.options.defaultCwd));
			case "resources.setEnabled": {
				const cwd = resolve(command.cwd ?? this.options.defaultCwd);
				const settingsPath = this.configPath("settings", command.scope === "project" ? "project" : "global", cwd);
				return setResourceEnabled(cwd, settingsPath, command.kind, command.path, command.enabled);
			}
			case "settings.patch": {
				const path = this.configPath("settings", command.scope, command.cwd);
				const merged = patchJsonFile(path, command.patch);
				log.info(`patched ${path}`);
				return {
					file: "settings",
					scope: command.scope,
					path,
					exists: true,
					content: `${JSON.stringify(merged, null, 2)}\n`,
				};
			}
			case "trust.get":
				return readTrust(resolve(command.cwd));
			case "trust.set":
				return writeTrust(resolve(command.cwd), command.trusted);
			case "terminal.open": {
				const dir = resolve(command.cwd);
				if (!existsSync(dir)) throw new Error(`directory does not exist: ${dir}`);
				return this.terminals.open(command.kind, dir, command.sessionPath, command.cols, command.rows, emit);
			}
			case "terminal.attach":
				return this.terminals.attach(command.terminalId, emit);
			case "terminal.detach":
				this.terminals.detach(command.terminalId, emit);
				return null;
			case "terminal.input":
				this.terminals.input(command.terminalId, command.data);
				return null;
			case "terminal.resize":
				this.terminals.resize(command.terminalId, command.cols, command.rows);
				return null;
			case "terminal.close":
				this.terminals.close(command.terminalId);
				return null;
			case "terminal.list":
				return this.terminals.list();
			case "config.read":
				return this.readConfig(command.file, command.scope, command.cwd);
			case "config.write":
				return this.writeConfig(command.file, command.scope, command.cwd, command.content);
			case "sessions.exportJsonl": {
				const file = resolve(command.sessionPath);
				// pi writes the file only once an assistant message exists, so a brand new
				// session (or a fresh fork) has a path but no file yet: hand back an empty document.
				if (!existsSync(file)) return { fileName: basename(file), content: "" };
				return { fileName: basename(file), content: await readFile(file, "utf8") };
			}
			case "sessions.list":
				return this.listSessions(command.cwd);
			case "projects.list":
				return this.listProjects();
			case "sessions.create":
				return this.createSession(command.cwd, command.model, command.name, command.options);
			case "sessions.open":
				return this.openSession(command.sessionPath);
			case "sessions.close":
				return this.closeSession(command.sessionId);
			case "sessions.delete":
				return this.deleteSession(command.sessionPath);
			case "models.list":
				return this.listModels();
			case "fs.searchFiles":
				return { files: await searchFiles(resolve(command.cwd), command.query, command.limit) };
			case "fs.listDirs":
				return listDirs(command.path ?? this.options.defaultCwd);
			default: {
				const unknown: never = command;
				throw new Error(`unknown host command ${(unknown as { type?: string }).type}`);
			}
		}
	}

	async listSessions(cwd?: string): Promise<SessionSummary[]> {
		const all = await listAllSessions();
		const filtered = cwd ? all.filter((s) => resolve(s.cwd) === resolve(cwd)) : all;
		const dirExists = new Map<string, boolean>();
		const cwdExists = (dir: string): boolean => {
			const key = resolve(dir);
			const cached = dirExists.get(key);
			if (cached !== undefined) return cached;
			const value = existsSync(key);
			dirExists.set(key, value);
			return value;
		};
		const byFile = new Map<string, TauSession>();
		for (const s of this.sessions.values()) if (s.sessionFile) byFile.set(resolve(s.sessionFile), s);
		const known = new Set<string>();
		const out: SessionSummary[] = [];
		for (const summary of filtered) {
			const live = byFile.get(resolve(summary.path));
			known.add(resolve(summary.path));
			// pi dates a session by its last entry, so a clone or fork inherits the origin's date
			// and would be buried in the list; the file's own mtime says when the copy was written.
			// The same rule has to apply whether or not a process is attached, otherwise merely
			// opening a session would change its position.
			const modified = Math.max(summary.modified, fileMtime(summary.path));
			if (live) {
				const snapshot = live.snapshot().state;
				out.push({
					...summary,
					running: live.alive,
					handle: live.handle,
					needsInput: snapshot.needsInput,
					isStreaming: live.isStreaming || snapshot.bashRunning,
					failed: snapshot.lastRunFailed,
					modified,
					cwdExists: cwdExists(summary.cwd),
				});
			} else out.push({ ...summary, modified, cwdExists: cwdExists(summary.cwd) });
		}
		// Sessions whose file pi has not written yet (no assistant message so far).
		for (const s of this.sessions.values()) {
			const file = s.sessionFile ? resolve(s.sessionFile) : undefined;
			if (file && known.has(file)) continue;
			if (cwd && resolve(s.cwd) !== resolve(cwd)) continue;
			const snap = s.snapshot();
			const first = snap.messages.find((m) => m.role === "user");
			const firstText =
				first && first.role === "user" ? first.content.map((c) => (c.type === "text" ? c.text : "")).join(" ") : "";
			const summary: SessionSummary = {
				id: s.piSessionId,
				handle: s.handle,
				path: s.sessionFile ?? `pending:${s.handle}`,
				cwd: s.cwd,
				created: s.startedAt,
				// No file yet, so the session is as old as its process; Date.now() here would
				// make the entry jump on every refresh.
				modified: s.startedAt,
				messageCount: snap.messages.length,
				firstMessage: firstText.slice(0, 200),
				running: s.alive,
				isStreaming: s.isStreaming,
			};
			if (snap.state.sessionName !== undefined) summary.name = snap.state.sessionName;
			summary.needsInput = snap.state.needsInput;
			summary.failed = snap.state.lastRunFailed;
			if (s.ephemeral) summary.ephemeral = true;
			out.push(summary);
		}
		out.sort((a, b) => b.modified - a.modified);
		return out;
	}

	async listProjects(): Promise<ProjectInfo[]> {
		const sessions = await this.listSessions();
		const map = new Map<string, ProjectInfo>();
		for (const s of sessions) {
			const key = resolve(s.cwd);
			const existing = map.get(key);
			if (existing) {
				existing.sessionCount++;
				existing.lastModified = Math.max(existing.lastModified, s.modified);
			} else
				map.set(key, {
					cwd: key,
					name: basename(key) || key,
					sessionCount: 1,
					lastModified: s.modified,
					exists: s.cwdExists !== false,
				});
		}
		if (!map.has(resolve(this.options.defaultCwd))) {
			const key = resolve(this.options.defaultCwd);
			map.set(key, { cwd: key, name: basename(key) || key, sessionCount: 0, lastModified: 0, exists: existsSync(key) });
		}
		return [...map.values()].sort((a, b) => b.lastModified - a.lastModified);
	}

	async createSession(
		cwd: string,
		model?: { provider: string; id: string },
		name?: string,
		options?: SessionCreateOptions,
	): Promise<{ sessionId: string }> {
		const dir = resolve(cwd);
		if (!existsSync(dir)) throw new Error(`directory does not exist: ${dir}`);
		const args = [...this.options.piArgs];
		const spec = model ? `${model.provider}/${model.id}` : defaultModelSpec(dir);
		if (spec) args.push("--model", spec);
		if (name) args.push("--name", name);
		if (options) args.push(...startupArgs(options));
		const startOptions = this.startOptions(dir, args);
		if (options?.ephemeral) startOptions.ephemeral = true;
		const session = await TauSession.start(startOptions);
		this.track(session);
		return { sessionId: session.handle };
	}

	async openSession(sessionPath: string): Promise<{ sessionId: string }> {
		const file = resolve(sessionPath);
		for (const s of this.sessions.values()) {
			if (s.sessionFile && resolve(s.sessionFile) === file && s.alive) return { sessionId: s.handle };
		}
		const pending = this.starting.get(file);
		if (pending) return { sessionId: (await pending).handle };
		if (!existsSync(file)) throw new Error(`session file not found: ${file}`);
		const cwd = readSessionHeaderCwd(file) ?? this.options.defaultCwd;
		const promise = TauSession.start(
			this.startOptions(existsSync(cwd) ? cwd : this.options.defaultCwd, [...this.options.piArgs, "--session", file]),
		);
		this.starting.set(file, promise);
		try {
			const session = await promise;
			this.track(session);
			return { sessionId: session.handle };
		} finally {
			this.starting.delete(file);
		}
	}

	async closeSession(handle: string): Promise<null> {
		const session = this.sessions.get(handle);
		if (!session) return null;
		await session.close();
		this.sessions.delete(handle);
		this.notifyChanged();
		return null;
	}

	async deleteSession(sessionPath: string): Promise<null> {
		const file = resolve(sessionPath);
		for (const [handle, s] of this.sessions) {
			if (s.sessionFile && resolve(s.sessionFile) === file) {
				await s.close();
				this.sessions.delete(handle);
			}
		}
		if (existsSync(file)) await unlink(file);
		this.notifyChanged();
		return null;
	}

	/** Copy a JSONL session file into pi's session directory for `cwd` and open it. */
	private async importSession(sourcePath: string, cwd?: string): Promise<{ sessionId: string; path: string }> {
		const source = resolve(sourcePath);
		if (!existsSync(source)) throw new Error(`file not found: ${source}`);
		const raw = await readFile(source, "utf8");
		const newline = raw.indexOf("\n");
		let header: { type?: string; cwd?: string; id?: string };
		try {
			header = JSON.parse(raw.slice(0, newline === -1 ? raw.length : newline)) as typeof header;
		} catch {
			throw new Error("not a pi session file: the first line is not JSON");
		}
		if (header.type !== "session") throw new Error("not a pi session file: the first line is not a session header");
		const targetCwd = resolve(cwd ?? header.cwd ?? this.options.defaultCwd);
		const dir = sessionDirFor(targetCwd);
		await mkdir(dir, { recursive: true });
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const target = join(dir, `${stamp}_${header.id ?? "imported"}.jsonl`);
		// The header's cwd decides which project the session shows up under, so an explicit
		// target directory has to be written into the copy as well.
		let content = raw;
		if (cwd !== undefined && header.cwd !== targetCwd) {
			const rest = newline === -1 ? "" : raw.slice(newline);
			content = JSON.stringify({ ...header, cwd: targetCwd }) + rest;
		}
		await writeFile(target, content, "utf8");
		log.info(`imported ${source} -> ${target}`);
		this.notifyChanged();
		const { sessionId } = await this.openSession(target);
		return { sessionId, path: target };
	}

	async listModels(): Promise<ModelInfo[]> {
		const live = this.all().find((s) => s.alive);
		if (live) {
			try {
				return (await live.execute({ type: "getModels" })) as ModelInfo[];
			} catch (error) {
				log.warn(`models via session failed: ${(error as Error).message}`);
			}
		}
		return listAvailableModels();
	}

	async closeAll(): Promise<void> {
		this.terminals.closeAll();
		await Promise.all(this.all().map((s) => s.close()));
		this.sessions.clear();
	}

	private configPath(file: ConfigFile, scope: ConfigScope, cwd: string | undefined): string {
		const name = `${file}.json`;
		if (scope === "global") return join(agentDir(), name);
		return join(resolve(cwd ?? this.options.defaultCwd), ".pi", name);
	}

	private async readConfig(file: ConfigFile, scope: ConfigScope, cwd: string | undefined): Promise<ConfigDocument> {
		const path = this.configPath(file, scope, cwd);
		const exists = existsSync(path);
		return { file, scope, path, exists, content: exists ? await readFile(path, "utf8") : "" };
	}

	private async writeConfig(
		file: ConfigFile,
		scope: ConfigScope,
		cwd: string | undefined,
		content: string,
	): Promise<ConfigDocument> {
		try {
			JSON.parse(content);
		} catch (error) {
			throw new Error(`not valid JSON: ${(error as Error).message}`);
		}
		const path = this.configPath(file, scope, cwd);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, content.endsWith("\n") ? content : `${content}\n`, { encoding: "utf8", mode: 0o600 });
		log.info(`wrote ${path}`);
		return { file, scope, path, exists: true, content };
	}

	private startOptions(cwd: string, args: string[]): Parameters<typeof TauSession.start>[0] {
		const out: Parameters<typeof TauSession.start>[0] = { cwd, args, idleTimeoutMs: this.options.idleTimeoutMs };
		if (this.options.piBinary) out.piBinary = this.options.piBinary;
		return out;
	}

	private changedTimer: NodeJS.Timeout | undefined;

	/** Coalesce bursts of list changes into one notification. */
	private notifyChanged(): void {
		if (this.changedTimer) return;
		this.changedTimer = setTimeout(() => {
			this.changedTimer = undefined;
			this.emit("sessions.changed");
		}, 100);
	}

	private track(session: TauSession): void {
		this.sessions.set(session.handle, session);
		session.on("exit", () => this.notifyChanged());
		session.on("idle", () => {
			this.sessions.delete(session.handle);
			this.notifyChanged();
		});
		session.on("changed", () => this.notifyChanged());
		this.notifyChanged();
		log.info(`session ${session.handle} started (pid ${session.alive ? "alive" : "dead"}) in ${session.cwd}`);
	}
}

/** Map GUI session options onto pi's startup flags. */
function startupArgs(options: SessionCreateOptions): string[] {
	const args: string[] = [];
	if (options.systemPrompt) args.push("--system-prompt", options.systemPrompt);
	if (options.appendSystemPrompt) args.push("--append-system-prompt", options.appendSystemPrompt);
	if (options.tools) {
		if (options.tools.length === 0) args.push("--no-tools");
		else args.push("--tools", options.tools.join(","));
	}
	if (options.excludeTools?.length) args.push("--exclude-tools", options.excludeTools.join(","));
	for (const extension of options.extensions ?? []) args.push("-e", extension);
	if (options.noContextFiles) args.push("--no-context-files");
	if (options.ephemeral) args.push("--no-session");
	if (options.thinkingLevel) args.push("--thinking", options.thinkingLevel);
	return args;
}

/** File mtime in milliseconds, 0 when the file is gone. */
function fileMtime(path: string): number {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return 0;
	}
}

async function listDirs(path: string): Promise<{ path: string; dirs: string[] }> {
	const dir = resolve(path);
	const entries = await readdir(dir, { withFileTypes: true });
	const dirs = entries
		.filter((e) => e.isDirectory() && !e.name.startsWith("."))
		.map((e) => e.name)
		.sort((a, b) => a.localeCompare(b));
	return { path: dir, dirs };
}

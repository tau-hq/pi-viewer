import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "../logger.js";
import { JsonLineSplitter } from "./jsonl.js";
import type {
	PiCommand,
	PiEvent,
	PiExtensionUiRequest,
	PiExtensionUiResponse,
	PiResponse,
	PiStdoutRecord,
} from "./rpc-types.js";

const log = createLogger("rpc");

/**
 * Locate the pi package root by walking up from its main module, then return the
 * path declared in `bin.pi`. This is the interactive CLI, used for PTY terminals.
 */
export function resolvePiBin(): string {
	// pi's exports map has no "require" condition, so only import.meta.resolve works here.
	const main = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
	let dir = dirname(main);
	for (let i = 0; i < 6; i++) {
		const candidate = join(dir, "package.json");
		if (existsSync(candidate)) {
			const pkg = JSON.parse(readFileSync(candidate, "utf8")) as {
				name?: string;
				bin?: Record<string, string> | string;
			};
			if (pkg.name === "@earendil-works/pi-coding-agent") {
				const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.pi;
				if (!bin) throw new Error("pi-coding-agent package.json has no bin.pi");
				return join(dir, bin);
			}
		}
		dir = dirname(dir);
	}
	throw new Error("cannot locate @earendil-works/pi-coding-agent package root");
}

/**
 * Entry point for RPC mode: pi's dedicated `rpc-entry` when the package exports it
 * (it sets the mode itself), otherwise the plain CLI, which then needs `--mode rpc`.
 */
export function resolvePiCli(): string {
	try {
		const url = import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry");
		if (url.startsWith("file:")) return fileURLToPath(url);
	} catch {
		// fall through to the bin lookup
	}
	return resolvePiBin();
}

export interface RpcProcessOptions {
	cwd: string;
	/**
	 * Standalone pi executable (e.g. a Tauri sidecar built with pi's build-binaries script).
	 * When set, it is executed directly with `--mode rpc`; otherwise the npm package runs under the current Node.
	 */
	piBinary?: string;
	/** Extra CLI arguments, e.g. ["--session", path] or ["--model", "provider/id"]. */
	args?: string[];
	env?: NodeJS.ProcessEnv;
	requestTimeoutMs?: number;
}

export class RpcError extends Error {
	readonly command: string;
	constructor(command: string, message: string) {
		super(message);
		this.name = "RpcError";
		this.command = command;
	}
}

interface Pending {
	command: string;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

/**
 * One `pi --mode rpc` child process. Speaks strict LF-delimited JSON lines on
 * stdin/stdout (see docs/rpc.md: never use readline, it also splits on U+2028).
 */
export class RpcProcess extends EventEmitter {
	readonly cwd: string;
	private child: ChildProcess | undefined;
	private readonly splitter = new JsonLineSplitter();
	private nextId = 1;
	private readonly pending = new Map<string, Pending>();
	private readonly requestTimeoutMs: number;
	private readonly stderrTail: string[] = [];
	private exited = false;
	private exitInfo: { code: number | null; signal: NodeJS.Signals | null } | undefined;

	constructor(private readonly options: RpcProcessOptions) {
		super();
		this.cwd = options.cwd;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
	}

	get pid(): number | undefined {
		return this.child?.pid;
	}

	get alive(): boolean {
		return this.child !== undefined && !this.exited;
	}

	get lastStderr(): string {
		return this.stderrTail.join("");
	}

	start(): void {
		if (this.child) throw new Error("RpcProcess already started");
		let executable: string;
		let args: string[];
		if (this.options.piBinary) {
			executable = this.options.piBinary;
			args = ["--mode", "rpc", ...(this.options.args ?? [])];
		} else {
			const cli = resolvePiCli();
			// rpc-entry sets the mode itself; the plain CLI needs --mode rpc.
			const modeArgs = cli.endsWith("rpc-entry.js") ? [] : ["--mode", "rpc"];
			executable = process.execPath;
			args = [cli, ...modeArgs, ...(this.options.args ?? [])];
		}
		log.info(`spawn pi rpc in ${this.cwd}`, this.options.piBinary ? [executable, ...args] : args.slice(1));
		const child = spawn(executable, args, {
			cwd: this.cwd,
			env: { ...process.env, ...this.options.env, TAU_HOST: "1" },
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.child = child;
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => this.onStdout(chunk));
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			this.stderrTail.push(chunk);
			while (this.stderrTail.length > 200) this.stderrTail.shift();
			log.debug(`stderr: ${chunk.trimEnd()}`);
		});
		child.on("error", (error) => {
			log.error(`process error: ${error.message}`);
			this.emit("error", error);
		});
		child.on("exit", (code, signal) => {
			this.exited = true;
			this.exitInfo = { code, signal };
			log.info(`pi rpc exited code=${code} signal=${signal}`);
			const reason = new Error(`pi process exited (code ${code}, signal ${signal})`);
			for (const [id, p] of this.pending) {
				clearTimeout(p.timer);
				p.reject(new RpcError(p.command, reason.message));
				this.pending.delete(id);
			}
			this.emit("exit", code, signal);
		});
	}

	/** Send a command and wait for its correlated response. */
	request<T = unknown>(command: PiCommand, timeoutMs?: number): Promise<T> {
		if (!this.alive) return Promise.reject(new RpcError(command.type, "pi process is not running"));
		const id = String(this.nextId++);
		const payload = JSON.stringify({ id, ...command });
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new RpcError(command.type, `timeout after ${timeoutMs ?? this.requestTimeoutMs} ms`));
			}, timeoutMs ?? this.requestTimeoutMs);
			this.pending.set(id, { command: command.type, resolve: resolve as (v: unknown) => void, reject, timer });
			this.writeLine(payload);
		});
	}

	respondUi(response: PiExtensionUiResponse): void {
		this.writeLine(JSON.stringify(response));
	}

	/** Close stdin, which asks pi to shut down gracefully; escalate to SIGTERM/SIGKILL. */
	async stop(graceMs = 5_000): Promise<void> {
		const child = this.child;
		if (!child || this.exited) return;
		await new Promise<void>((resolve) => {
			const done = (): void => {
				clearTimeout(t1);
				clearTimeout(t2);
				resolve();
			};
			child.once("exit", done);
			try {
				child.stdin?.end();
			} catch {
				// ignore
			}
			const t1 = setTimeout(() => child.kill("SIGTERM"), graceMs);
			const t2 = setTimeout(() => child.kill("SIGKILL"), graceMs * 2);
		});
	}

	private writeLine(line: string): void {
		const stdin = this.child?.stdin;
		if (!stdin || stdin.destroyed) throw new RpcError("write", "stdin closed");
		stdin.write(`${line}\n`);
	}

	private onStdout(chunk: string): void {
		for (const line of this.splitter.push(chunk)) this.onLine(line);
	}

	private onLine(line: string): void {
		let record: PiStdoutRecord;
		try {
			record = JSON.parse(line) as PiStdoutRecord;
		} catch {
			log.warn(`non-JSON stdout line: ${line.slice(0, 200)}`);
			return;
		}
		if (record.type === "response") {
			const response = record as PiResponse;
			const id = response.id;
			const pending = id !== undefined ? this.pending.get(id) : undefined;
			if (!pending) {
				log.debug(`unmatched response for ${response.command}`);
				return;
			}
			this.pending.delete(id as string);
			clearTimeout(pending.timer);
			if (response.success) pending.resolve(response.data);
			else pending.reject(new RpcError(response.command, response.error ?? "unknown error"));
			return;
		}
		if (record.type === "extension_ui_request") {
			this.emit("ui", record as PiExtensionUiRequest);
			return;
		}
		if (record.type === "extension_error") {
			this.emit("extensionError", record);
			return;
		}
		this.emit("event", record as PiEvent);
	}

	get exit(): { code: number | null; signal: NodeJS.Signals | null } | undefined {
		return this.exitInfo;
	}
}

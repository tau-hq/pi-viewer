import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { HostEnvelope, TerminalInfo } from "@pi-tau/shared";
import { createLogger } from "../logger.js";
import { resolvePiBin } from "../pi/rpc-process.js";

const log = createLogger("terminal");
const SCROLLBACK_BYTES = 256 * 1024;
const MAX_TERMINALS = 16;

type Emit = (envelope: HostEnvelope) => void;

interface PtyModule {
	spawn: (file: string, args: string[], options: Record<string, unknown>) => PtyLike;
}

interface PtyLike {
	pid: number;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(signal?: string): void;
	onData(cb: (data: string) => void): void;
	onExit(cb: (event: { exitCode: number }) => void): void;
}

interface Terminal {
	info: TerminalInfo;
	pty: PtyLike;
	scrollback: string[];
	scrollbackBytes: number;
	attached: Set<Emit>;
}

export interface TerminalOptions {
	/** Standalone pi executable; otherwise pi runs from the npm package under Node. */
	piBinary?: string;
	/** Extra pi arguments, e.g. ["-e", extensionPath]. */
	piArgs: string[];
	/**
	 * Directory or entry file of a node-pty installation on disk. A compiled sidecar
	 * cannot load the bundled native module, so the desktop app ships node-pty as a
	 * resource and points here.
	 */
	nodePtyPath?: string;
}

/**
 * Real PTYs streamed to the browser. Kind "pi" runs pi's own terminal UI, which is
 * the escape hatch for everything the JSON protocol cannot carry (extension
 * components, custom editors). node-pty is loaded lazily so a host without the
 * native module (e.g. a compiled sidecar) still works, minus terminals.
 */
export class Terminals {
	private readonly terminals = new Map<string, Terminal>();
	private ptyModule: PtyModule | undefined;

	constructor(private readonly options: TerminalOptions) {}

	private async pty(): Promise<PtyModule> {
		if (this.ptyModule) return this.ptyModule;
		const attempts: string[] = ["node-pty"];
		if (this.options.nodePtyPath) {
			const base = this.options.nodePtyPath;
			attempts.unshift(base.endsWith(".js") ? base : join(base, "lib", "index.js"));
		}
		const errors: string[] = [];
		for (const specifier of attempts) {
			try {
				const mod = (await import(specifier)) as unknown as PtyModule | { default: PtyModule };
				const resolved = "spawn" in mod ? mod : mod.default;
				if (typeof resolved?.spawn !== "function") throw new Error("module has no spawn()");
				this.ptyModule = resolved;
				log.info(`node-pty loaded from ${specifier}`);
				return resolved;
			} catch (error) {
				errors.push(`${specifier}: ${(error as Error).message}`);
			}
		}
		throw new Error(`terminals are unavailable here (node-pty not loadable: ${errors.join("; ")})`);
	}

	list(): TerminalInfo[] {
		return [...this.terminals.values()].map((t) => ({ ...t.info }));
	}

	async open(
		kind: "pi" | "shell",
		cwd: string,
		sessionPath: string | undefined,
		cols: number,
		rows: number,
		emit: Emit,
	): Promise<TerminalInfo> {
		if (this.terminals.size >= MAX_TERMINALS) throw new Error(`at most ${MAX_TERMINALS} terminals`);
		const pty = await this.pty();
		let file: string;
		let args: string[];
		if (kind === "pi") {
			if (this.options.piBinary) {
				file = this.options.piBinary;
				args = [...this.options.piArgs];
			} else {
				file = process.execPath;
				args = [resolvePiBin(), ...this.options.piArgs];
			}
			if (sessionPath) args.push("--session", sessionPath);
		} else {
			file = process.env.SHELL ?? "/bin/bash";
			args = ["-l"];
		}
		const id = randomUUID();
		const child = pty.spawn(file, args, {
			name: "xterm-256color",
			cols,
			rows,
			cwd,
			env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", TAU_TERMINAL: "1" },
		});
		const info: TerminalInfo = { id, kind, cwd, alive: true, cols, rows, startedAt: Date.now() };
		if (sessionPath) info.sessionPath = sessionPath;
		const terminal: Terminal = { info, pty: child, scrollback: [], scrollbackBytes: 0, attached: new Set([emit]) };
		this.terminals.set(id, terminal);
		child.onData((data) => {
			terminal.scrollback.push(data);
			terminal.scrollbackBytes += data.length;
			while (terminal.scrollbackBytes > SCROLLBACK_BYTES && terminal.scrollback.length > 1) {
				const dropped = terminal.scrollback.shift() as string;
				terminal.scrollbackBytes -= dropped.length;
			}
			for (const target of terminal.attached) target({ type: "terminal.data", terminalId: id, data });
		});
		child.onExit(({ exitCode }) => {
			terminal.info.alive = false;
			terminal.info.exitCode = exitCode;
			log.info(`terminal ${id} (${kind}) exited ${exitCode}`);
			for (const target of terminal.attached) target({ type: "terminal.exit", terminalId: id, code: exitCode });
			setTimeout(() => this.terminals.delete(id), 60_000).unref();
		});
		log.info(`terminal ${id} (${kind}) pid ${child.pid} in ${cwd}`);
		return { ...info };
	}

	attach(id: string, emit: Emit): TerminalInfo {
		const terminal = this.get(id);
		terminal.attached.add(emit);
		if (terminal.scrollback.length > 0)
			emit({ type: "terminal.data", terminalId: id, data: terminal.scrollback.join("") });
		if (!terminal.info.alive) emit({ type: "terminal.exit", terminalId: id, code: terminal.info.exitCode });
		return { ...terminal.info };
	}

	detach(id: string, emit: Emit): void {
		this.terminals.get(id)?.attached.delete(emit);
	}

	detachAll(emit: Emit): void {
		for (const terminal of this.terminals.values()) terminal.attached.delete(emit);
	}

	input(id: string, data: string): void {
		const terminal = this.get(id);
		if (!terminal.info.alive) throw new Error("terminal has exited");
		terminal.pty.write(data);
	}

	resize(id: string, cols: number, rows: number): void {
		const terminal = this.get(id);
		if (cols < 2 || rows < 1 || cols > 500 || rows > 200) throw new Error("invalid size");
		terminal.info.cols = cols;
		terminal.info.rows = rows;
		if (terminal.info.alive) terminal.pty.resize(cols, rows);
	}

	close(id: string): void {
		const terminal = this.terminals.get(id);
		if (!terminal) return;
		if (terminal.info.alive) terminal.pty.kill();
		this.terminals.delete(id);
	}

	closeAll(): void {
		for (const id of [...this.terminals.keys()]) this.close(id);
	}

	private get(id: string): Terminal {
		const terminal = this.terminals.get(id);
		if (!terminal) throw new Error(`unknown terminal ${id}`);
		return terminal;
	}
}

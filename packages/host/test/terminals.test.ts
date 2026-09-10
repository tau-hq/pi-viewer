import type { HostEnvelope } from "@pi-tau/shared";
import { describe, expect, it, vi } from "vitest";
import { Terminals } from "../src/server/terminals.js";

interface FakePty {
	pid: number;
	written: string[];
	size: { cols: number; rows: number };
	killed: boolean;
	emit(data: string): void;
	exit(code: number): void;
}

/** Installs a fake node-pty on the instance so no real process is spawned. */
function withFakePty(terminals: Terminals): FakePty[] {
	const created: FakePty[] = [];
	const spawn = (_file: string, _args: string[], options: Record<string, unknown>): unknown => {
		let onData: (d: string) => void = () => undefined;
		let onExit: (e: { exitCode: number }) => void = () => undefined;
		const fake: FakePty = {
			pid: 4711 + created.length,
			written: [],
			size: { cols: options.cols as number, rows: options.rows as number },
			killed: false,
			emit: (data) => onData(data),
			exit: (code) => onExit({ exitCode: code }),
		};
		created.push(fake);
		return {
			pid: fake.pid,
			write: (d: string) => fake.written.push(d),
			resize: (cols: number, rows: number) => {
				fake.size = { cols, rows };
			},
			kill: () => {
				fake.killed = true;
			},
			onData: (cb: (d: string) => void) => {
				onData = cb;
			},
			onExit: (cb: (e: { exitCode: number }) => void) => {
				onExit = cb;
			},
		};
	};
	(terminals as unknown as { ptyModule: unknown }).ptyModule = { spawn };
	return created;
}

describe("Terminals", () => {
	it("streams data to attached clients, replays scrollback on attach and reports exit", async () => {
		const terminals = new Terminals({ piArgs: [] });
		const ptys = withFakePty(terminals);
		const first: HostEnvelope[] = [];
		const info = await terminals.open("shell", process.cwd(), undefined, 80, 24, (e) => first.push(e));
		expect(info.alive).toBe(true);
		const pty = ptys[0];
		if (!pty) throw new Error("no pty");
		pty.emit("hello ");
		pty.emit("world");
		expect(first.filter((e) => e.type === "terminal.data")).toHaveLength(2);

		// A second client attaching gets the whole scrollback in one frame.
		const second: HostEnvelope[] = [];
		terminals.attach(info.id, (e) => second.push(e));
		expect(second).toEqual([{ type: "terminal.data", terminalId: info.id, data: "hello world" }]);

		terminals.input(info.id, "ls\r");
		expect(pty.written).toEqual(["ls\r"]);
		terminals.resize(info.id, 120, 40);
		expect(pty.size).toEqual({ cols: 120, rows: 40 });
		expect(terminals.list()[0]?.cols).toBe(120);

		pty.exit(3);
		expect(first.at(-1)).toEqual({ type: "terminal.exit", terminalId: info.id, code: 3 });
		expect(() => terminals.input(info.id, "x")).toThrow(/exited/);

		// A client attaching after the exit still learns the code.
		const late: HostEnvelope[] = [];
		const lateInfo = terminals.attach(info.id, (e) => late.push(e));
		expect(lateInfo.exitCode).toBe(3);
		expect(late.at(-1)).toEqual({ type: "terminal.exit", terminalId: info.id, code: 3 });
	});

	it("detaches clients and rejects unknown ids and bad sizes", async () => {
		const terminals = new Terminals({ piArgs: [] });
		const ptys = withFakePty(terminals);
		const seen: HostEnvelope[] = [];
		const emit = (e: HostEnvelope): void => seen.push(e);
		const info = await terminals.open("shell", process.cwd(), undefined, 80, 24, emit);
		terminals.detach(info.id, emit);
		ptys[0]?.emit("ignored");
		expect(seen).toHaveLength(0);
		expect(() => terminals.resize(info.id, 1, 1)).toThrow(/invalid size/);
		expect(() => terminals.input("nope", "x")).toThrow(/unknown terminal/);
		terminals.closeAll();
		expect(ptys[0]?.killed).toBe(true);
		expect(terminals.list()).toHaveLength(0);
	});

	it("gives a clear error when node-pty cannot be loaded", async () => {
		const terminals = new Terminals({ piArgs: [] });
		vi.spyOn(terminals as unknown as { pty: () => Promise<unknown> }, "pty").mockRejectedValue(
			new Error("terminals are unavailable here (node-pty not loadable: boom)"),
		);
		await expect(terminals.open("shell", process.cwd(), undefined, 80, 24, () => undefined)).rejects.toThrow(
			/node-pty not loadable/,
		);
	});
});

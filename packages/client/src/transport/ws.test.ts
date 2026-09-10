import { type HostEnvelope, type HostInfo, type SessionSnapshot, TAU_PROTOCOL_VERSION } from "@pi-tau/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SocketLike, TauTransport, TransportError } from "./ws";

class FakeSocket implements SocketLike {
	static instances: FakeSocket[] = [];
	readyState = 0;
	sent: string[] = [];
	onopen: SocketLike["onopen"] = null;
	onmessage: SocketLike["onmessage"] = null;
	onclose: SocketLike["onclose"] = null;
	onerror: SocketLike["onerror"] = null;

	constructor(readonly url: string) {
		FakeSocket.instances.push(this);
	}

	open(): void {
		this.readyState = 1;
		this.onopen?.({});
	}

	receive(envelope: HostEnvelope): void {
		this.onmessage?.({ data: JSON.stringify(envelope) });
	}

	send(data: string): void {
		if (this.readyState !== 1) throw new Error("not open");
		this.sent.push(data);
	}

	close(): void {
		if (this.readyState === 3) return;
		this.readyState = 3;
		this.onclose?.({});
	}

	/** Server-side close. */
	drop(): void {
		this.close();
	}

	get sentEnvelopes(): Array<Record<string, unknown>> {
		return this.sent.map((line) => JSON.parse(line) as Record<string, unknown>);
	}

	get last(): Record<string, unknown> | undefined {
		return this.sentEnvelopes.at(-1);
	}
}

const host: HostInfo = {
	name: "tau-host",
	version: "0.0.1",
	piVersion: "0.85.1",
	platform: "linux",
	homeCwd: "/root",
	defaultCwd: "/srv",
};

function snapshot(): SessionSnapshot {
	return {
		state: {
			sessionId: "s1",
			cwd: "/srv",
			thinkingLevel: "off",
			isStreaming: false,
			isCompacting: false,
			steeringMode: "all",
			followUpMode: "all",
			autoCompactionEnabled: true,
			autoRetryEnabled: true,
			messageCount: 0,
			pendingMessageCount: 0,
			processAlive: true,
		},
		messages: [],
		queue: { steering: [], followUp: [] },
		activeTools: [],
		statuses: {},
		widgets: {},
		pendingUi: [],
	};
}

function createTransport(pingIntervalMs = 100) {
	return new TauTransport({
		url: "ws://test/ws",
		createSocket: (url) => new FakeSocket(url),
		timing: { commandTimeoutMs: 1000, longCommandTimeoutMs: 5000, pingIntervalMs, pongTimeoutMs: 50 },
	});
}

function connected(pingIntervalMs?: number): { transport: TauTransport; socket: FakeSocket } {
	const transport = createTransport(pingIntervalMs);
	transport.connect();
	const socket = FakeSocket.instances.at(-1) as FakeSocket;
	socket.open();
	socket.receive({ type: "hello", protocolVersion: TAU_PROTOCOL_VERSION, host });
	return { transport, socket };
}

beforeEach(() => {
	vi.useFakeTimers();
	FakeSocket.instances = [];
	vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("handshake", () => {
	it("sends hello on open and becomes connected after the host hello", () => {
		const transport = createTransport();
		const statuses: string[] = [];
		transport.on("status", (status) => statuses.push(status));
		transport.connect();
		const socket = FakeSocket.instances[0] as FakeSocket;
		expect(socket.url).toBe("ws://test/ws");
		socket.open();
		expect(socket.last).toEqual({ type: "hello", protocolVersion: TAU_PROTOCOL_VERSION, clientName: "tau-web" });
		socket.receive({ type: "hello", protocolVersion: TAU_PROTOCOL_VERSION, host });
		expect(transport.status).toBe("connected");
		expect(transport.host).toEqual(host);
		expect(statuses).toEqual(["connecting", "connected"]);
	});

	it("refuses an incompatible protocol version", () => {
		const transport = createTransport();
		const errors: string[] = [];
		transport.on("error", (message) => errors.push(message));
		transport.connect();
		const socket = FakeSocket.instances[0] as FakeSocket;
		socket.open();
		socket.receive({ type: "hello", protocolVersion: TAU_PROTOCOL_VERSION + 1, host });
		expect(transport.status).toBe("offline");
		expect(errors[0]).toMatch(/protocol mismatch/);
		vi.advanceTimersByTime(60_000);
		expect(FakeSocket.instances).toHaveLength(1);
	});
});

describe("commands", () => {
	it("correlates results by id and resolves with data", async () => {
		const { transport, socket } = connected();
		const promise = transport.send({ type: "sessions.list" });
		const envelope = socket.last as { id: string; type: string; command: { type: string } };
		expect(envelope.type).toBe("cmd");
		expect(envelope.command.type).toBe("sessions.list");
		socket.receive({ type: "result", id: envelope.id, ok: true, data: [{ id: "s1" }] });
		await expect(promise).resolves.toEqual([{ id: "s1" }]);
	});

	it("rejects with the command error", async () => {
		const { transport, socket } = connected();
		const promise = transport.sendSession("s1", { type: "abort" });
		const envelope = socket.last as { id: string; sessionId: string };
		expect(envelope.sessionId).toBe("s1");
		socket.receive({ type: "result", id: envelope.id, ok: false, error: { code: "no_session", message: "gone" } });
		await expect(promise).rejects.toMatchObject({ code: "no_session", message: "gone" });
	});

	it("times out; prompt gets the long timeout", async () => {
		const { transport } = connected(60_000);
		const quick = transport.send({ type: "models.list" });
		const slow = transport.sendSession("s1", { type: "prompt", message: "hi" });
		const quickResult = quick.catch((error: unknown) => error);
		const slowResult = slow.catch((error: unknown) => error);
		vi.advanceTimersByTime(1000);
		await expect(quickResult).resolves.toBeInstanceOf(TransportError);
		vi.advanceTimersByTime(4000);
		await expect(slowResult).resolves.toMatchObject({ code: "timeout" });
	});

	it("queues commands sent before the handshake and flushes them on hello", async () => {
		const transport = createTransport();
		transport.connect();
		const promise = transport.send({ type: "host.info" });
		const socket = FakeSocket.instances[0] as FakeSocket;
		socket.open();
		expect(socket.sentEnvelopes.map((e) => e.type)).toEqual(["hello"]);
		socket.receive({ type: "hello", protocolVersion: TAU_PROTOCOL_VERSION, host });
		const envelope = socket.last as { id: string; type: string };
		expect(envelope.type).toBe("cmd");
		socket.receive({ type: "result", id: envelope.id, ok: true, data: host });
		await expect(promise).resolves.toEqual(host);
	});

	it("rejects in-flight commands when the connection drops", async () => {
		const { transport, socket } = connected();
		const promise = transport.send({ type: "models.list" }).catch((error: unknown) => error);
		socket.drop();
		await expect(promise).resolves.toMatchObject({ code: "disconnected" });
	});
});

describe("sessions and seq handling", () => {
	it("subscribes, applies snapshot and in-order events, ignores duplicates", () => {
		const { transport, socket } = connected();
		const seen: number[] = [];
		transport.on("event", (_sid, seq) => seen.push(seq));
		transport.subscribe("s1");
		expect(socket.last).toEqual({ type: "subscribe", sessionId: "s1" });
		socket.receive({ type: "session.snapshot", sessionId: "s1", seq: 10, snapshot: snapshot() });
		socket.receive({ type: "session.event", sessionId: "s1", seq: 11, event: { type: "turn.start" } });
		socket.receive({ type: "session.event", sessionId: "s1", seq: 11, event: { type: "turn.start" } });
		socket.receive({ type: "session.event", sessionId: "s1", seq: 9, event: { type: "turn.start" } });
		socket.receive({ type: "session.event", sessionId: "s1", seq: 12, event: { type: "turn.end" } });
		expect(seen).toEqual([11, 12]);
		expect(transport.lastSeq("s1")).toBe(12);
	});

	it("re-subscribes with afterSeq on a gap and resumes at the continuation", () => {
		const { transport, socket } = connected();
		const seen: number[] = [];
		transport.on("event", (_sid, seq) => seen.push(seq));
		transport.subscribe("s1");
		socket.receive({ type: "session.snapshot", sessionId: "s1", seq: 1, snapshot: snapshot() });
		socket.receive({ type: "session.event", sessionId: "s1", seq: 2, event: { type: "turn.start" } });
		socket.receive({ type: "session.event", sessionId: "s1", seq: 5, event: { type: "turn.end" } });
		expect(socket.last).toEqual({ type: "subscribe", sessionId: "s1", afterSeq: 2 });
		socket.receive({ type: "session.event", sessionId: "s1", seq: 6, event: { type: "turn.end" } });
		expect(socket.sentEnvelopes.filter((e) => e.type === "subscribe")).toHaveLength(2); // no storm
		socket.receive({ type: "session.event", sessionId: "s1", seq: 3, event: { type: "turn.start" } });
		socket.receive({ type: "session.event", sessionId: "s1", seq: 4, event: { type: "turn.start" } });
		socket.receive({ type: "session.event", sessionId: "s1", seq: 5, event: { type: "turn.end" } });
		expect(seen).toEqual([2, 3, 4, 5]);
	});

	it("accepts a snapshot as gap recovery", () => {
		const { transport, socket } = connected();
		const seen: number[] = [];
		transport.on("event", (_sid, seq) => seen.push(seq));
		transport.subscribe("s1");
		socket.receive({ type: "session.snapshot", sessionId: "s1", seq: 1, snapshot: snapshot() });
		socket.receive({ type: "session.event", sessionId: "s1", seq: 7, event: { type: "turn.end" } });
		socket.receive({ type: "session.snapshot", sessionId: "s1", seq: 8, snapshot: snapshot() });
		socket.receive({ type: "session.event", sessionId: "s1", seq: 9, event: { type: "turn.end" } });
		expect(seen).toEqual([9]);
	});

	it("re-subscribes with the last seq after a reconnect", () => {
		const { transport, socket } = connected();
		transport.subscribe("s1");
		socket.receive({ type: "session.snapshot", sessionId: "s1", seq: 4, snapshot: snapshot() });
		socket.drop();
		expect(transport.status).toBe("reconnecting");
		vi.advanceTimersByTime(500);
		const next = FakeSocket.instances[1] as FakeSocket;
		next.open();
		next.receive({ type: "hello", protocolVersion: TAU_PROTOCOL_VERSION, host });
		expect(next.sentEnvelopes.at(-1)).toEqual({ type: "subscribe", sessionId: "s1", afterSeq: 4 });
		expect(transport.status).toBe("connected");
	});

	it("remembers the seq across unsubscribe/subscribe and forgets it on session.gone", () => {
		const { transport, socket } = connected();
		const gone: string[] = [];
		transport.on("gone", (sid) => gone.push(sid));
		transport.subscribe("s1");
		socket.receive({ type: "session.snapshot", sessionId: "s1", seq: 3, snapshot: snapshot() });
		transport.unsubscribe("s1");
		expect(socket.last).toEqual({ type: "unsubscribe", sessionId: "s1" });
		transport.subscribe("s1");
		expect(socket.last).toEqual({ type: "subscribe", sessionId: "s1", afterSeq: 3 });
		socket.receive({ type: "session.gone", sessionId: "s1", reason: "closed" });
		expect(gone).toEqual(["s1"]);
		expect(transport.isSubscribed("s1")).toBe(false);
		expect(transport.lastSeq("s1")).toBeUndefined();
	});
});

describe("keep-alive and backoff", () => {
	it("pings and treats a missing pong as a dead connection", () => {
		const { socket } = connected();
		vi.advanceTimersByTime(100);
		expect(socket.last?.type).toBe("ping");
		vi.advanceTimersByTime(50);
		expect(socket.readyState).toBe(3);
		expect(FakeSocket.instances).toHaveLength(1);
		vi.advanceTimersByTime(500);
		expect(FakeSocket.instances).toHaveLength(2);
	});

	it("keeps the connection alive when pongs arrive", () => {
		const { socket } = connected();
		for (let i = 0; i < 5; i++) {
			vi.advanceTimersByTime(100);
			const ping = socket.last as { type: string; t: number };
			expect(ping.type).toBe("ping");
			socket.receive({ type: "pong", t: ping.t });
		}
		expect(socket.readyState).toBe(1);
	});

	it("backs off exponentially up to the cap", () => {
		const transport = createTransport();
		transport.connect();
		const delays: number[] = [];
		let previous = 0;
		for (let i = 0; i < 6; i++) {
			const socket = FakeSocket.instances.at(-1) as FakeSocket;
			socket.open();
			socket.drop();
			const started = FakeSocket.instances.length;
			let waited = 0;
			while (FakeSocket.instances.length === started && waited < 10_000) {
				vi.advanceTimersByTime(50);
				waited += 50;
			}
			delays.push(waited - previous);
			previous = 0;
		}
		expect(delays).toEqual([500, 1000, 2000, 4000, 5000, 5000]);
	});
});

describe("auth flow envelopes", () => {
	it("delivers prompt, event and done to subscribers", () => {
		const { socket, transport } = connected();
		const seen: string[] = [];
		transport.on("authPrompt", (flowId, promptId, prompt) => seen.push(`prompt ${flowId}/${promptId}:${prompt.type}`));
		transport.on("authEvent", (flowId, event) => seen.push(`event ${flowId}:${event.type}`));
		transport.on("authDone", (flowId, ok, error) => seen.push(`done ${flowId}:${ok}:${error ?? "-"}`));

		socket.receive({ type: "auth.event", flowId: "f1", event: { type: "progress", message: "working" } });
		socket.receive({
			type: "auth.prompt",
			flowId: "f1",
			promptId: "p1",
			prompt: { type: "secret", message: "Enter the key" },
		});
		socket.receive({ type: "auth.done", flowId: "f1", ok: false, error: "aborted" });
		socket.receive({ type: "auth.done", flowId: "f2", ok: true });

		expect(seen).toEqual(["event f1:progress", "prompt f1/p1:secret", "done f1:false:aborted", "done f2:true:-"]);
	});
});

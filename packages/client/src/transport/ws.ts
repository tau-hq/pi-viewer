import {
	type AuthFlowEvent,
	type AuthPrompt,
	type ClientEnvelope,
	type CommandError,
	type HostCommand,
	type HostEnvelope,
	type HostInfo,
	type SessionCommand,
	type SessionEvent,
	type SessionSnapshot,
	TAU_PROTOCOL_VERSION,
} from "@pi-tau/shared";
import { randomId } from "../lib/ids";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline";

export interface TransportEvents {
	status: (status: ConnectionStatus, attempt: number) => void;
	hello: (host: HostInfo) => void;
	error: (message: string) => void;
	snapshot: (sessionId: string, seq: number, snapshot: SessionSnapshot) => void;
	event: (sessionId: string, seq: number, event: SessionEvent) => void;
	gone: (sessionId: string, reason: string) => void;
	sessionsChanged: () => void;
	/** Provider login flow: a question from the provider, waiting for `auth.answer`. */
	authPrompt: (flowId: string, promptId: string, prompt: AuthPrompt) => void;
	/** Provider login flow: progress, links, device codes. */
	authEvent: (flowId: string, event: AuthFlowEvent) => void;
	authDone: (flowId: string, ok: boolean, error: string | undefined) => void;
	/** PTY output of a terminal this connection is attached to. */
	terminalData: (terminalId: string, data: string) => void;
	/** The terminal's process ended; `code` is undefined when the host does not know it. */
	terminalExit: (terminalId: string, code: number | undefined) => void;
}

export class TransportError extends Error implements CommandError {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "TransportError";
	}
}

// Handler props are declared bivariantly so the DOM WebSocket satisfies the interface.
type Handler<E> = { bivarianceHack(event: E): void }["bivarianceHack"];

/** Minimal WebSocket surface; the DOM WebSocket satisfies it, tests inject a fake. */
export interface SocketLike {
	readonly readyState: number;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	onopen: Handler<unknown> | null;
	onmessage: Handler<{ data: unknown }> | null;
	onclose: Handler<unknown> | null;
	onerror: Handler<unknown> | null;
}

export interface TransportOptions {
	url?: string;
	clientName?: string;
	createSocket?: (url: string) => SocketLike;
	/** Override timing for tests. */
	timing?: Partial<Timing>;
}

interface Timing {
	commandTimeoutMs: number;
	longCommandTimeoutMs: number;
	pingIntervalMs: number;
	pongTimeoutMs: number;
	helloTimeoutMs: number;
	backoffMinMs: number;
	backoffMaxMs: number;
}

const DEFAULT_TIMING: Timing = {
	commandTimeoutMs: 30_000,
	longCommandTimeoutMs: 10 * 60_000,
	pingIntervalMs: 20_000,
	pongTimeoutMs: 10_000,
	helloTimeoutMs: 10_000,
	backoffMinMs: 500,
	backoffMaxMs: 5_000,
};

const LONG_COMMANDS: ReadonlySet<string> = new Set([
	"prompt",
	"compact",
	"bash",
	"fork",
	"clone",
	"navigateTree",
	// Refreshing the catalogs goes out to every configured provider.
	"models.refresh",
	// npm and git runs on the host; a cold install of a package takes a while.
	"packages.install",
	"packages.remove",
	"packages.update",
]);

interface PendingCommand {
	envelope: Extract<ClientEnvelope, { type: "cmd" }>;
	resolve: (data: unknown) => void;
	reject: (error: TransportError) => void;
	timer: ReturnType<typeof setTimeout>;
	sent: boolean;
}

interface Subscription {
	/** Highest seq applied for this session; undefined until the first snapshot/event. */
	lastSeq: number | undefined;
	/** After a gap: ignore events until the snapshot or the continuation arrives. */
	resyncing: boolean;
}

function defaultUrl(): string {
	const loc = globalThis.location;
	if (!loc) return "ws://127.0.0.1:8787/ws";
	const proto = loc.protocol === "https:" ? "wss:" : "ws:";
	return `${proto}//${loc.host}/ws`;
}

/**
 * WebSocket transport to the Tau host: hello handshake, command/result correlation,
 * per-session seq tracking with gap recovery, keep-alive and reconnection with backoff.
 */
export class TauTransport {
	private readonly url: string;
	private readonly clientName: string;
	private readonly createSocket: (url: string) => SocketLike;
	private readonly timing: Timing;
	private readonly listeners = new Map<keyof TransportEvents, Set<(...args: never[]) => void>>();
	private readonly pending = new Map<string, PendingCommand>();
	private readonly subscriptions = new Map<string, Subscription>();
	private readonly rememberedSeq = new Map<string, number>();
	private socket: SocketLike | undefined;
	private statusValue: ConnectionStatus = "offline";
	private hostValue: HostInfo | undefined;
	private attempt = 0;
	private closedByUser = true;
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private helloTimer: ReturnType<typeof setTimeout> | undefined;
	private pingTimer: ReturnType<typeof setInterval> | undefined;
	private pongTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(options: TransportOptions = {}) {
		this.url = options.url ?? defaultUrl();
		this.clientName = options.clientName ?? "tau-web";
		this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
		this.timing = { ...DEFAULT_TIMING, ...options.timing };
	}

	get status(): ConnectionStatus {
		return this.statusValue;
	}

	get host(): HostInfo | undefined {
		return this.hostValue;
	}

	get reconnectAttempt(): number {
		return this.attempt;
	}

	on<K extends keyof TransportEvents>(type: K, handler: TransportEvents[K]): () => void {
		let set = this.listeners.get(type);
		if (!set) {
			set = new Set();
			this.listeners.set(type, set);
		}
		set.add(handler);
		return () => set.delete(handler);
	}

	private emit<K extends keyof TransportEvents>(type: K, ...args: Parameters<TransportEvents[K]>): void {
		const set = this.listeners.get(type);
		if (!set) return;
		for (const handler of set) {
			try {
				(handler as (...a: Parameters<TransportEvents[K]>) => void)(...args);
			} catch (error) {
				console.error("transport listener failed", error);
			}
		}
	}

	connect(): void {
		if (this.socket) return;
		this.closedByUser = false;
		this.attempt = 0;
		this.open();
	}

	close(): void {
		this.closedByUser = true;
		this.clearReconnect();
		const socket = this.socket;
		this.socket = undefined;
		this.stopKeepAlive();
		if (socket) socket.close();
		this.rejectInFlight("disconnected", "connection closed");
		this.setStatus("offline");
	}

	// ---- commands ---------------------------------------------------------

	send(command: HostCommand): Promise<unknown> {
		return this.dispatch({ type: "cmd", id: randomId(), command }, this.timeoutFor(command.type));
	}

	sendSession(sessionId: string, command: SessionCommand): Promise<unknown> {
		return this.dispatch({ type: "cmd", id: randomId(), sessionId, command }, this.timeoutFor(command.type));
	}

	private timeoutFor(commandType: string): number {
		return LONG_COMMANDS.has(commandType) ? this.timing.longCommandTimeoutMs : this.timing.commandTimeoutMs;
	}

	private dispatch(envelope: Extract<ClientEnvelope, { type: "cmd" }>, timeoutMs: number): Promise<unknown> {
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(envelope.id);
				reject(new TransportError("timeout", `${envelope.command.type}: no answer within ${timeoutMs} ms`));
			}, timeoutMs);
			const entry: PendingCommand = { envelope, resolve, reject, timer, sent: false };
			this.pending.set(envelope.id, entry);
			if (this.statusValue === "connected") this.transmit(entry);
		});
	}

	private transmit(entry: PendingCommand): void {
		try {
			this.sendRaw(entry.envelope);
			entry.sent = true;
		} catch (error) {
			clearTimeout(entry.timer);
			this.pending.delete(entry.envelope.id);
			entry.reject(new TransportError("send_failed", error instanceof Error ? error.message : String(error)));
		}
	}

	private flushOutbox(): void {
		for (const entry of this.pending.values()) {
			if (!entry.sent) this.transmit(entry);
		}
	}

	private rejectInFlight(code: string, message: string): void {
		for (const [id, entry] of this.pending) {
			if (!entry.sent) continue;
			clearTimeout(entry.timer);
			this.pending.delete(id);
			entry.reject(new TransportError(code, message));
		}
	}

	// ---- subscriptions ----------------------------------------------------

	subscribe(sessionId: string, afterSeq?: number): void {
		const existing = this.subscriptions.get(sessionId);
		const lastSeq = afterSeq ?? existing?.lastSeq ?? this.rememberedSeq.get(sessionId);
		const sub: Subscription = { lastSeq, resyncing: false };
		this.subscriptions.set(sessionId, sub);
		if (this.statusValue === "connected") this.sendSubscribe(sessionId, sub);
	}

	unsubscribe(sessionId: string): void {
		const sub = this.subscriptions.get(sessionId);
		if (!sub) return;
		this.subscriptions.delete(sessionId);
		if (sub.lastSeq !== undefined) this.rememberedSeq.set(sessionId, sub.lastSeq);
		if (this.statusValue === "connected") this.trySendRaw({ type: "unsubscribe", sessionId });
	}

	isSubscribed(sessionId: string): boolean {
		return this.subscriptions.has(sessionId);
	}

	lastSeq(sessionId: string): number | undefined {
		return this.subscriptions.get(sessionId)?.lastSeq ?? this.rememberedSeq.get(sessionId);
	}

	private sendSubscribe(sessionId: string, sub: Subscription): void {
		this.trySendRaw({
			type: "subscribe",
			sessionId,
			...(sub.lastSeq === undefined ? {} : { afterSeq: sub.lastSeq }),
		});
	}

	// ---- socket lifecycle -------------------------------------------------

	private open(): void {
		this.clearReconnect();
		this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");
		let socket: SocketLike;
		try {
			socket = this.createSocket(this.url);
		} catch (error) {
			this.emit("error", error instanceof Error ? error.message : String(error));
			this.scheduleReconnect();
			return;
		}
		this.socket = socket;
		socket.onopen = () => {
			if (socket !== this.socket) return;
			this.trySendRaw({ type: "hello", protocolVersion: TAU_PROTOCOL_VERSION, clientName: this.clientName });
			this.helloTimer = setTimeout(() => {
				if (socket === this.socket && this.statusValue !== "connected") socket.close();
			}, this.timing.helloTimeoutMs);
		};
		socket.onmessage = (event) => {
			if (socket === this.socket) this.handleMessage(event.data);
		};
		socket.onerror = () => {
			// The close event follows; nothing to do here.
		};
		socket.onclose = () => this.handleClose(socket);
	}

	private handleClose(socket: SocketLike): void {
		if (socket !== this.socket) return;
		this.socket = undefined;
		this.stopKeepAlive();
		this.rejectInFlight("disconnected", "connection lost");
		if (this.closedByUser) {
			this.setStatus("offline");
			return;
		}
		this.scheduleReconnect();
	}

	private scheduleReconnect(): void {
		this.attempt += 1;
		const base = Math.min(this.timing.backoffMaxMs, this.timing.backoffMinMs * 2 ** (this.attempt - 1));
		const delay = base + Math.random() * base * 0.3;
		this.setStatus("reconnecting");
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			if (!this.closedByUser) this.open();
		}, delay);
	}

	private clearReconnect(): void {
		if (this.reconnectTimer !== undefined) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}
	}

	private startKeepAlive(): void {
		this.stopKeepAlive();
		this.pingTimer = setInterval(() => {
			if (this.statusValue !== "connected") return;
			this.trySendRaw({ type: "ping", t: Date.now() });
			if (this.pongTimer === undefined) {
				this.pongTimer = setTimeout(() => {
					this.pongTimer = undefined;
					this.socket?.close();
				}, this.timing.pongTimeoutMs);
			}
		}, this.timing.pingIntervalMs);
	}

	private stopKeepAlive(): void {
		if (this.pingTimer !== undefined) clearInterval(this.pingTimer);
		if (this.pongTimer !== undefined) clearTimeout(this.pongTimer);
		if (this.helloTimer !== undefined) clearTimeout(this.helloTimer);
		this.pingTimer = undefined;
		this.pongTimer = undefined;
		this.helloTimer = undefined;
	}

	private setStatus(status: ConnectionStatus): void {
		if (status === this.statusValue) return;
		this.statusValue = status;
		this.emit("status", status, this.attempt);
	}

	private sendRaw(envelope: ClientEnvelope): void {
		const socket = this.socket;
		if (socket?.readyState !== 1) throw new TransportError("disconnected", "socket not open");
		socket.send(JSON.stringify(envelope));
	}

	private trySendRaw(envelope: ClientEnvelope): void {
		try {
			this.sendRaw(envelope);
		} catch (error) {
			this.emit("error", error instanceof Error ? error.message : String(error));
		}
	}

	// ---- inbound ----------------------------------------------------------

	private handleMessage(raw: unknown): void {
		if (typeof raw !== "string") return;
		let envelope: HostEnvelope;
		try {
			envelope = JSON.parse(raw) as HostEnvelope;
		} catch {
			this.emit("error", "malformed message from host");
			return;
		}
		if (typeof envelope !== "object" || envelope === null || typeof envelope.type !== "string") return;
		switch (envelope.type) {
			case "hello":
				this.handleHello(envelope.protocolVersion, envelope.host);
				break;
			case "result":
				this.handleResult(envelope);
				break;
			case "session.snapshot":
				this.handleSnapshot(envelope.sessionId, envelope.seq, envelope.snapshot);
				break;
			case "session.event":
				this.handleEvent(envelope.sessionId, envelope.seq, envelope.event);
				break;
			case "session.gone":
				this.subscriptions.delete(envelope.sessionId);
				this.rememberedSeq.delete(envelope.sessionId);
				this.emit("gone", envelope.sessionId, envelope.reason);
				break;
			case "sessions.changed":
				this.emit("sessionsChanged");
				break;
			case "auth.prompt":
				this.emit("authPrompt", envelope.flowId, envelope.promptId, envelope.prompt);
				break;
			case "auth.event":
				this.emit("authEvent", envelope.flowId, envelope.event);
				break;
			case "auth.done":
				this.emit("authDone", envelope.flowId, envelope.ok, envelope.error);
				break;
			case "terminal.data":
				this.emit("terminalData", envelope.terminalId, envelope.data);
				break;
			case "terminal.exit":
				this.emit("terminalExit", envelope.terminalId, envelope.code);
				break;
			case "pong":
				if (this.pongTimer !== undefined) {
					clearTimeout(this.pongTimer);
					this.pongTimer = undefined;
				}
				break;
		}
	}

	private handleHello(protocolVersion: number, host: HostInfo): void {
		if (this.helloTimer !== undefined) {
			clearTimeout(this.helloTimer);
			this.helloTimer = undefined;
		}
		if (protocolVersion !== TAU_PROTOCOL_VERSION) {
			this.emit("error", `protocol mismatch: host ${protocolVersion}, client ${TAU_PROTOCOL_VERSION}`);
			this.closedByUser = true;
			this.socket?.close();
			return;
		}
		this.hostValue = host;
		this.attempt = 0;
		this.setStatus("connected");
		this.emit("hello", host);
		for (const [sessionId, sub] of this.subscriptions) {
			sub.resyncing = false;
			this.sendSubscribe(sessionId, sub);
		}
		this.flushOutbox();
		this.startKeepAlive();
	}

	private handleResult(envelope: Extract<HostEnvelope, { type: "result" }>): void {
		const entry = this.pending.get(envelope.id);
		if (!entry) return;
		this.pending.delete(envelope.id);
		clearTimeout(entry.timer);
		if (envelope.ok) {
			entry.resolve(envelope.data);
		} else {
			const error = envelope.error ?? { code: "error", message: "command failed" };
			entry.reject(new TransportError(error.code, error.message));
		}
	}

	private handleSnapshot(sessionId: string, seq: number, snapshot: SessionSnapshot): void {
		const sub = this.subscriptions.get(sessionId);
		if (!sub) return;
		sub.lastSeq = seq;
		sub.resyncing = false;
		this.emit("snapshot", sessionId, seq, snapshot);
	}

	private handleEvent(sessionId: string, seq: number, event: SessionEvent): void {
		const sub = this.subscriptions.get(sessionId);
		if (!sub) return;
		if (sub.lastSeq !== undefined) {
			if (seq <= sub.lastSeq) return; // duplicate or replayed
			if (seq !== sub.lastSeq + 1) {
				if (!sub.resyncing) {
					sub.resyncing = true;
					this.sendSubscribe(sessionId, sub);
				}
				return; // gap: wait for the replay or snapshot
			}
		}
		sub.resyncing = false;
		sub.lastSeq = seq;
		this.emit("event", sessionId, seq, event);
	}
}

import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import {
	type ClientEnvelope,
	type CommandError,
	type HostEnvelope,
	isSessionCommandEnvelope,
	TAU_PROTOCOL_VERSION,
} from "@pi-tau/shared";
import { Hono } from "hono";
import type { WSContext } from "hono/ws";
import { createLogger } from "../logger.js";
import { RpcError } from "../pi/rpc-process.js";
import type { SessionRegistry } from "../session/registry.js";
import type { SeqEvent, TauSession } from "../session/tau-session.js";

const log = createLogger("ws");
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;

function safeEqual(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

export interface ServerOptions {
	host: string;
	port: number;
	registry: SessionRegistry;
	/** Directory with the built client (index.html); optional. */
	staticDir?: string;
	/** Allowed Origin header values for WebSocket upgrades; empty = same host only. */
	allowedOrigins: string[];
	/** When set, clients must present this token in their hello envelope. */
	token?: string;
}

interface ClientConnection {
	id: number;
	ws: WSContext;
	subscriptions: Map<string, () => void>;
	helloDone: boolean;
	/** Stable sender identity used by host-level flows (login prompts). */
	emit: (envelope: HostEnvelope) => void;
}

export function createServer(options: ServerOptions): { app: Hono; start(): HttpServer; stop(): Promise<void> } {
	const app = new Hono();
	const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
	const connections = new Set<ClientConnection>();
	let nextConnectionId = 1;

	const send = (conn: ClientConnection, envelope: HostEnvelope): void => {
		const raw = conn.ws.raw as { bufferedAmount?: number } | undefined;
		if (raw?.bufferedAmount !== undefined && raw.bufferedAmount > MAX_BUFFERED_BYTES) {
			log.warn(`client ${conn.id} too slow (${raw.bufferedAmount} bytes buffered), closing`);
			conn.ws.close(1013, "backpressure");
			return;
		}
		conn.ws.send(JSON.stringify(envelope));
	};

	const subscribe = (conn: ClientConnection, session: TauSession, afterSeq: number | undefined): void => {
		conn.subscriptions.get(session.handle)?.();
		const onEvent = (entry: SeqEvent): void =>
			send(conn, { type: "session.event", sessionId: session.handle, seq: entry.seq, event: entry.event });
		session.on("event", onEvent);
		session.addSubscriber();
		const unsubscribe = (): void => {
			session.off("event", onEvent);
			session.removeSubscriber();
			conn.subscriptions.delete(session.handle);
		};
		conn.subscriptions.set(session.handle, unsubscribe);
		const replay = afterSeq !== undefined ? session.eventsAfter(afterSeq) : undefined;
		if (replay) {
			for (const entry of replay)
				send(conn, { type: "session.event", sessionId: session.handle, seq: entry.seq, event: entry.event });
		} else {
			send(conn, {
				type: "session.snapshot",
				sessionId: session.handle,
				seq: session.currentSeq,
				snapshot: session.snapshot(),
			});
		}
	};

	const toError = (error: unknown): CommandError => {
		if (error instanceof RpcError) return { code: `pi.${error.command}`, message: error.message };
		if (error instanceof Error) return { code: "host", message: error.message };
		return { code: "host", message: String(error) };
	};

	const handle = async (conn: ClientConnection, envelope: ClientEnvelope): Promise<void> => {
		if (options.token && !conn.helloDone && envelope.type !== "hello") {
			send(conn, { type: "unauthorized", reason: "hello with token required first" });
			conn.ws.close(4401, "unauthorized");
			return;
		}
		switch (envelope.type) {
			case "hello":
				if (options.token && !safeEqual(envelope.token ?? "", options.token)) {
					log.warn(`client ${conn.id} rejected: bad token`);
					send(conn, { type: "unauthorized", reason: "token required" });
					conn.ws.close(4401, "unauthorized");
					return;
				}
				conn.helloDone = true;
				if (envelope.protocolVersion !== TAU_PROTOCOL_VERSION)
					log.warn(`client ${conn.id} protocol ${envelope.protocolVersion} != ${TAU_PROTOCOL_VERSION}`);
				send(conn, { type: "hello", protocolVersion: TAU_PROTOCOL_VERSION, host: options.registry.hostInfo() });
				return;
			case "ping":
				send(conn, { type: "pong", t: envelope.t });
				return;
			case "subscribe": {
				const session = options.registry.get(envelope.sessionId);
				if (!session) {
					send(conn, { type: "session.gone", sessionId: envelope.sessionId, reason: "unknown session" });
					return;
				}
				subscribe(conn, session, envelope.afterSeq);
				return;
			}
			case "unsubscribe":
				conn.subscriptions.get(envelope.sessionId)?.();
				return;
			case "cmd": {
				try {
					let data: unknown;
					if (isSessionCommandEnvelope(envelope)) {
						const session = options.registry.get(envelope.sessionId);
						if (!session) throw new Error(`unknown session ${envelope.sessionId}`);
						data = await session.execute(envelope.command);
					} else {
						data = await options.registry.execute(envelope.command, conn.emit);
					}
					const result: HostEnvelope = { type: "result", id: envelope.id, ok: true };
					if (data !== undefined) result.data = data;
					send(conn, result);
				} catch (error) {
					log.warn(`command ${envelope.command.type} failed: ${(error as Error).message}`);
					send(conn, { type: "result", id: envelope.id, ok: false, error: toError(error) });
				}
				return;
			}
			default:
				log.warn(`unknown envelope ${(envelope as { type?: string }).type}`);
		}
	};

	app.get("/api/health", (c) => c.json({ ok: true, name: "Tau", sessions: options.registry.all().length }));

	app.get(
		"/ws",
		upgradeWebSocket((c) => {
			const origin = c.req.header("origin");
			const host = c.req.header("host");
			const originOk =
				origin === undefined ||
				options.allowedOrigins.includes(origin) ||
				(host !== undefined && (origin === `http://${host}` || origin === `https://${host}`));
			const conn: ClientConnection = {
				id: nextConnectionId++,
				ws: undefined as unknown as WSContext,
				subscriptions: new Map(),
				helloDone: false,
				emit: (envelope) => send(conn, envelope),
			};
			return {
				onOpen(_event, ws) {
					conn.ws = ws;
					if (!originOk) {
						log.warn(`rejecting websocket from origin ${origin}`);
						ws.close(1008, "origin not allowed");
						return;
					}
					connections.add(conn);
					log.info(`client ${conn.id} connected (${connections.size} total)`);
				},
				onMessage(event, ws) {
					conn.ws = ws;
					let envelope: ClientEnvelope;
					try {
						envelope = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)) as ClientEnvelope;
					} catch {
						log.warn(`client ${conn.id} sent invalid JSON`);
						return;
					}
					void handle(conn, envelope);
				},
				onClose() {
					for (const unsubscribe of conn.subscriptions.values()) unsubscribe();
					options.registry.auth.cancelAllFor(conn.emit);
					options.registry.terminals.detachAll(conn.emit);
					connections.delete(conn);
					log.info(`client ${conn.id} disconnected (${connections.size} total)`);
				},
				onError(event) {
					log.warn(`client ${conn.id} error`, String((event as { message?: string }).message ?? event.type));
				},
			};
		}),
	);

	if (options.staticDir && existsSync(join(options.staticDir, "index.html"))) {
		log.info(`serving client from ${options.staticDir}`);
		// index.html must never be cached: it names the hashed asset bundles, so a stale copy
		// keeps a browser on an old client after a rebuild. The hashed assets are immutable.
		app.use("/*", async (c, next) => {
			await next();
			const path = new URL(c.req.url).pathname;
			if (path === "/" || path === "/index.html") c.header("Cache-Control", "no-store, must-revalidate");
			else if (path.startsWith("/assets/")) c.header("Cache-Control", "public, max-age=31536000, immutable");
		});
		app.use("/*", serveStatic({ root: options.staticDir }));
		app.get("*", serveStatic({ root: options.staticDir, path: "index.html" }));
	} else {
		app.get("/", (c) => c.text("Tau host is running. Client build not found; use the Vite dev server.", 200));
	}

	options.registry.on("sessions.changed", () => {
		for (const conn of connections) send(conn, { type: "sessions.changed" });
	});

	let httpServer: HttpServer | undefined;
	return {
		app,
		start() {
			const server = serve({ fetch: app.fetch, hostname: options.host, port: options.port }, (info) => {
				log.info(`Tau host listening on http://${info.address}:${info.port}`);
			}) as HttpServer;
			injectWebSocket(server);
			httpServer = server;
			return server;
		},
		async stop() {
			for (const conn of connections) conn.ws.close(1001, "server shutdown");
			await new Promise<void>((resolve) => (httpServer ? httpServer.close(() => resolve()) : resolve()));
		},
	};
}

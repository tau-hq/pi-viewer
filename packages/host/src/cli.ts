#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import pkg from "../package.json" with { type: "json" };
import { createLogger, setLogLevel } from "./logger.js";
import { createServer } from "./server/ws-server.js";
import { SessionRegistry } from "./session/registry.js";

const log = createLogger("host");

const { values } = parseArgs({
	options: {
		host: { type: "string", default: process.env.TAU_HOST_BIND ?? "127.0.0.1" },
		port: { type: "string", default: process.env.TAU_PORT ?? "8787" },
		cwd: { type: "string", default: process.env.TAU_DEFAULT_CWD ?? process.cwd() },
		static: { type: "string" },
		"idle-minutes": { type: "string", default: process.env.TAU_IDLE_MINUTES ?? "30" },
		"pi-arg": { type: "string", multiple: true, default: [] },
		"pi-bin": { type: "string", default: process.env.TAU_PI_BIN },
		"node-pty": { type: "string", default: process.env.TAU_NODE_PTY },
		origin: { type: "string", multiple: true, default: [] },
		"no-extension": { type: "boolean", default: false },
		token: { type: "string", default: process.env.TAU_TOKEN },
		extension: { type: "string", default: process.env.TAU_EXTENSION },
		verbose: { type: "boolean", short: "v", default: false },
		help: { type: "boolean", short: "h", default: false },
	},
});

if (values.help) {
	process.stdout.write(`Tau host: runs pi sessions and serves the Tau web client.

Options:
  --host <addr>         bind address (default 127.0.0.1; use 0.0.0.0 only behind auth)
  --port <n>            port (default 8787; 0 = pick a free port and print TAU_HOST_READY {"port":n})
  --cwd <dir>           default project directory for new sessions
  --static <dir>        built client directory to serve (default: packages/client/dist if present)
  --idle-minutes <n>    stop idle pi processes after n minutes without clients (0 = never)
  --pi-arg <arg>        extra argument passed to every pi process (repeatable)
  --pi-bin <path>       standalone pi executable instead of the npm package (desktop sidecar)
  --node-pty <path>     node-pty installation on disk for terminals (needed by a compiled sidecar)
  --origin <url>        additional allowed WebSocket origin (repeatable)
  --token <secret>      require this token in the client hello (env TAU_TOKEN); use it whenever the host is not on loopback
  --extension <path>    path to Tau's pi extension (default: packages/pi-extension; env TAU_EXTENSION)
  --no-extension        do not load Tau's pi extension
  -v, --verbose         debug logging
`);
	process.exit(0);
}

if (values.verbose) setLogLevel("debug");

const here = dirname(fileURLToPath(import.meta.url));
// Bundled at build time so a compiled sidecar has no file to read.
const pkgJson: { version: string } = pkg;
const defaultStatic = resolve(here, "..", "..", "client", "dist");
const staticDir = values.static ? resolve(values.static) : existsSync(defaultStatic) ? defaultStatic : undefined;

// Tau's own pi extension (approvals, tree navigation, tool management). TS source is fine: pi loads it via jiti.
const extensionCandidates = [
	values.extension,
	resolve(here, "..", "..", "pi-extension", "dist", "index.js"),
	resolve(here, "..", "..", "pi-extension", "src", "index.ts"),
].filter((p): p is string => typeof p === "string" && p.length > 0);
const extensionPath = extensionCandidates.find((p) => existsSync(p));
const piArgs = [...((values["pi-arg"] as string[]) ?? [])];
if (extensionPath && !values["no-extension"]) {
	piArgs.push("-e", extensionPath);
	log.info(`using Tau extension ${extensionPath}`);
} else log.warn("Tau extension not found; approvals and tree navigation are unavailable");

const registryOptions: ConstructorParameters<typeof SessionRegistry>[0] = {
	defaultCwd: resolve(values.cwd as string),
	idleTimeoutMs: Number(values["idle-minutes"]) * 60_000,
	piArgs,
	hostVersion: pkgJson.version,
};
if (typeof values["pi-bin"] === "string" && values["pi-bin"].length > 0)
	registryOptions.piBinary = resolve(values["pi-bin"]);
if (typeof values["node-pty"] === "string" && values["node-pty"].length > 0)
	registryOptions.nodePtyPath = resolve(values["node-pty"]);
const registry = new SessionRegistry(registryOptions);

const serverOptions: Parameters<typeof createServer>[0] = {
	host: values.host as string,
	port: Number(values.port),
	registry,
	allowedOrigins: (values.origin as string[]) ?? [],
};
if (staticDir) serverOptions.staticDir = staticDir;
if (typeof values.token === "string" && values.token.length > 0) serverOptions.token = values.token;
if ((values.host as string) !== "127.0.0.1" && (values.host as string) !== "localhost" && !serverOptions.token) {
	log.warn(`binding to ${values.host} without --token: anyone who can reach the port controls pi`);
}
const server = createServer(serverOptions);
const httpServer = server.start();
// With --port 0 the OS picks a free port; announce it so a desktop shell can read it from stdout.
httpServer.once("listening", () => {
	const address = httpServer.address();
	if (address && typeof address === "object")
		process.stdout.write(`TAU_HOST_READY ${JSON.stringify({ port: address.port, host: address.address })}\n`);
});

const shutdown = async (signal: string): Promise<void> => {
	log.info(`${signal} received, shutting down`);
	await server.stop();
	await registry.closeAll();
	process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

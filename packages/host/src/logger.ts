export type LogLevel = "debug" | "info" | "warn" | "error";

const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold: LogLevel = (process.env.TAU_LOG_LEVEL as LogLevel | undefined) ?? "info";

export function setLogLevel(level: LogLevel): void {
	threshold = level;
}

function write(level: LogLevel, scope: string, message: string, extra?: unknown): void {
	if (order[level] < order[threshold]) return;
	const time = new Date().toISOString().slice(11, 23);
	const line = `${time} ${level.padEnd(5)} [${scope}] ${message}`;
	const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
	if (extra === undefined) stream.write(`${line}\n`);
	else stream.write(`${line} ${typeof extra === "string" ? extra : JSON.stringify(extra)}\n`);
}

export interface Logger {
	debug(message: string, extra?: unknown): void;
	info(message: string, extra?: unknown): void;
	warn(message: string, extra?: unknown): void;
	error(message: string, extra?: unknown): void;
}

export function createLogger(scope: string): Logger {
	return {
		debug: (m, e) => write("debug", scope, m, e),
		info: (m, e) => write("info", scope, m, e),
		warn: (m, e) => write("warn", scope, m, e),
		error: (m, e) => write("error", scope, m, e),
	};
}

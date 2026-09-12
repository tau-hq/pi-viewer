import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolRequirement } from "@pi-tau/shared";
import { createLogger } from "./logger.js";

const log = createLogger("tools");
const run = promisify(execFile);
const INSTALL_TIMEOUT_MS = 5 * 60_000;

/**
 * Package managers this host knows how to drive, in the order they are tried. Each one is
 * used non-interactively: an install that would stop to ask something must fail instead of
 * hanging on a machine nobody is sitting at.
 */
const MANAGERS = [
	{ name: "apt-get", args: ["install", "-y"], needsRoot: true },
	{ name: "dnf", args: ["install", "-y"], needsRoot: true },
	{ name: "pacman", args: ["-S", "--noconfirm"], needsRoot: true },
	{ name: "apk", args: ["add"], needsRoot: true },
	{ name: "brew", args: ["install"], needsRoot: false },
] as const;

type ManagerName = (typeof MANAGERS)[number]["name"];

/**
 * What pi's tools need from the machine. pi's `grep` is ripgrep and its `find` is fd, not the
 * Unix programs of the same name: removing GNU grep changes nothing here. Everything not
 * listed needs nothing at all - the file tools are plain Node, and `bash` is dealt with by pi
 * itself, which falls back to `sh` and explains what to install when it finds neither.
 */
const REQUIREMENTS: Record<
	string,
	{ program: string; name: string; alternatives: string[]; packages: Partial<Record<ManagerName, string>> }
> = {
	grep: {
		program: "rg",
		name: "ripgrep",
		alternatives: [],
		packages: { "apt-get": "ripgrep", dnf: "ripgrep", pacman: "ripgrep", apk: "ripgrep", brew: "ripgrep" },
	},
	find: {
		// Debian calls the binary fdfind; pi looks for both names.
		program: "fd",
		name: "fd",
		alternatives: ["fdfind"],
		packages: { "apt-get": "fd-find", dnf: "fd-find", pacman: "fd", apk: "fd", brew: "fd" },
	},
};

/** What the checks need from the machine; injected so the decisions can be tested. */
export interface HostProbe {
	onPath: (program: string) => Promise<boolean>;
	isRoot: () => boolean;
	sudoWorks: () => Promise<boolean>;
}

async function onPath(program: string): Promise<boolean> {
	try {
		await run(process.platform === "win32" ? "where" : "which", [program], { timeout: 5_000 });
		return true;
	} catch {
		return false;
	}
}

async function firstManager(probe: HostProbe): Promise<(typeof MANAGERS)[number] | undefined> {
	for (const manager of MANAGERS) if (await probe.onPath(manager.name)) return manager;
	return undefined;
}

async function sudoWorks(): Promise<boolean> {
	if (!(await onPath("sudo"))) return false;
	try {
		// -n never asks for a password: either it is already allowed or it fails right away.
		await run("sudo", ["-n", "true"], { timeout: 5_000 });
		return true;
	} catch {
		return false;
	}
}

const realProbe: HostProbe = {
	onPath,
	isRoot: () => typeof process.getuid === "function" && process.getuid() === 0,
	sudoWorks,
};

/** Whether the host may install at all: as root it may, otherwise only through a silent sudo. */
async function canElevate(probe: HostProbe): Promise<boolean> {
	return probe.isRoot() || (await probe.sudoWorks());
}

/** What every tool needs, whether it is there, and how it could be put there. */
export async function toolRequirements(probe: HostProbe = realProbe): Promise<ToolRequirement[]> {
	const out: ToolRequirement[] = [];
	for (const [tool, spec] of Object.entries(REQUIREMENTS)) {
		const names = [spec.program, ...spec.alternatives];
		let available = false;
		for (const name of names) if (await probe.onPath(name)) available = true;
		const entry: ToolRequirement = { tool, program: spec.program, name: spec.name, available };
		if (!available) {
			const manager = await firstManager(probe);
			const pkg = manager ? spec.packages[manager.name] : undefined;
			if (manager && pkg) {
				if (!manager.needsRoot || (await canElevate(probe))) entry.install = { manager: manager.name, package: pkg };
				else
					entry.reason = `${spec.name} needs to be installed with ${manager.name}, which needs root. Tau runs as a user that cannot do that: install it yourself with "sudo ${manager.name} ${manager.args.join(" ")} ${pkg}".`;
			} else {
				entry.reason = `No package manager this host can drive was found, so ${spec.name} cannot be installed from here. Install it yourself and it will be picked up.`;
			}
		}
		out.push(entry);
	}
	return out;
}

export interface InstallResult {
	ok: boolean;
	message: string;
	available: boolean;
}

/** Install what a tool needs. Returns what happened, in words a reader can act on. */
export async function installToolRequirement(tool: string): Promise<InstallResult> {
	const spec = REQUIREMENTS[tool];
	if (!spec) return { ok: true, message: `${tool} needs nothing installed.`, available: true };
	const [current] = await toolRequirements().then((list) => list.filter((entry) => entry.tool === tool));
	if (current?.available) return { ok: true, message: `${spec.name} is already there.`, available: true };
	if (!current?.install) {
		return {
			ok: false,
			message: current?.reason ?? `${spec.program} cannot be installed from here.`,
			available: false,
		};
	}
	const manager = MANAGERS.find((entry) => entry.name === current.install?.manager);
	if (!manager) return { ok: false, message: "That package manager is gone.", available: false };
	const root = typeof process.getuid === "function" && process.getuid() === 0;
	const command = root || !manager.needsRoot ? manager.name : "sudo";
	const args =
		root || !manager.needsRoot
			? [...manager.args, current.install.package]
			: ["-n", manager.name, ...manager.args, current.install.package];
	log.info(`installing ${current.install.package} with ${command} ${args.join(" ")}`);
	try {
		await run(command, args, { timeout: INSTALL_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
	} catch (error) {
		const detail = (error as { stderr?: string; message?: string }).stderr?.trim() || (error as Error).message;
		log.warn(`installing ${current.install.package} failed: ${detail}`);
		return { ok: false, message: detail.slice(0, 600), available: false };
	}
	const after = await toolRequirements().then((list) => list.find((entry) => entry.tool === tool));
	return after?.available
		? { ok: true, message: `${current.install.package} installed with ${current.install.manager}.`, available: true }
		: {
				ok: false,
				message: `${current.install.package} was installed, but ${spec.program} is still not on the PATH.`,
				available: false,
			};
}

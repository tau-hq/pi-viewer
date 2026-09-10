/**
 * The only file that imports pi's SDK. Keep it small: everything that can go
 * through the RPC process should. A pi upgrade is reviewed here first.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	getAgentDir,
	getPackageDir,
	hasTrustRequiringProjectResources,
	ModelRuntime,
	ProjectTrustStore,
	SessionManager,
	SettingsManager,
	VERSION,
} from "@earendil-works/pi-coding-agent";
import type { ModelInfo, SessionSummary } from "@pi-tau/shared";
import { createLogger } from "./logger.js";

const log = createLogger("sdk");

export const piVersion: string = VERSION;

export function agentDir(): string {
	return getAgentDir();
}

export async function listAllSessions(): Promise<SessionSummary[]> {
	const infos = await SessionManager.listAll();
	return infos.map((info) => {
		const summary: SessionSummary = {
			id: info.id,
			path: info.path,
			cwd: info.cwd,
			created: info.created.getTime(),
			modified: info.modified.getTime(),
			messageCount: info.messageCount,
			firstMessage: info.firstMessage,
			running: false,
			isStreaming: false,
		};
		if (info.name !== undefined) summary.name = info.name;
		if (info.parentSessionPath !== undefined) summary.parentSessionPath = info.parentSessionPath;
		return summary;
	});
}

/** Read the cwd recorded in a session file header without touching pi's writer. */
export function readSessionHeaderCwd(sessionPath: string): string | undefined {
	try {
		const text = readFileSync(sessionPath, "utf8");
		const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
		const header = JSON.parse(firstLine) as { type?: string; cwd?: string };
		return header.type === "session" ? header.cwd : undefined;
	} catch (error) {
		log.warn(`cannot read session header of ${sessionPath}: ${(error as Error).message}`);
		return undefined;
	}
}

let runtimePromise: Promise<ModelRuntime> | undefined;

async function runtime(): Promise<ModelRuntime> {
	if (!runtimePromise) runtimePromise = ModelRuntime.create();
	return runtimePromise;
}

let modelsCache: { at: number; models: ModelInfo[] } | undefined;

/** Models with working auth, cached for a minute (the check may hit the network). */
export async function listAvailableModels(force = false): Promise<ModelInfo[]> {
	if (!force && modelsCache && Date.now() - modelsCache.at < 60_000) return modelsCache.models;
	const rt = await runtime();
	const models = await rt.getAvailable();
	const list: ModelInfo[] = models.map((m) => ({
		provider: m.provider,
		id: m.id,
		name: m.name,
		reasoning: m.reasoning,
		input: [...m.input],
		contextWindow: m.contextWindow,
		maxTokens: m.maxTokens,
	}));
	modelsCache = { at: Date.now(), models: list };
	return list;
}

export function defaultModelSpec(cwd: string): string | undefined {
	try {
		const settings = SettingsManager.create(cwd);
		const provider = settings.getDefaultProvider();
		const model = settings.getDefaultModel();
		if (provider && model) return `${provider}/${model}`;
		return model;
	} catch (error) {
		log.warn(`cannot read settings: ${(error as Error).message}`);
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// Provider authentication. The interaction types mirror pi-ai's AuthInteraction
// structurally (pi-ai is not a direct dependency of the host).
// ---------------------------------------------------------------------------

export type SdkAuthPrompt = { signal?: AbortSignal } & (
	| { type: "text"; message: string; placeholder?: string }
	| { type: "secret"; message: string; placeholder?: string }
	| { type: "select"; message: string; options: readonly { id: string; label: string; description?: string }[] }
	| { type: "manual_code"; message: string; placeholder?: string }
);

export type SdkAuthEvent =
	| { type: "info"; message: string; links?: readonly { url: string; label?: string }[] }
	| { type: "auth_url"; url: string; instructions?: string }
	| {
			type: "device_code";
			userCode: string;
			verificationUri: string;
			intervalSeconds?: number;
			expiresInSeconds?: number;
	  }
	| { type: "progress"; message: string };

export interface SdkAuthInteraction {
	signal?: AbortSignal;
	prompt(prompt: SdkAuthPrompt): Promise<string>;
	notify(event: SdkAuthEvent): void;
}

export interface ProviderAuthSummary {
	id: string;
	name: string;
	methods: { type: "api_key" | "oauth"; label: string; subscription?: boolean }[];
	status?: { type: "api_key" | "oauth"; source?: string };
}

export async function listProviders(): Promise<ProviderAuthSummary[]> {
	const rt = await runtime();
	const providers = rt.getProviders();
	const summaries = await Promise.all(
		providers.map(async (provider) => {
			const methods: ProviderAuthSummary["methods"] = [];
			const auth = provider.auth as {
				apiKey?: { name: string; login?: unknown };
				oauth?: { name: string; loginLabel?: string; isSubscription?: boolean };
			};
			if (auth.apiKey?.login) methods.push({ type: "api_key", label: auth.apiKey.name });
			if (auth.oauth) {
				const m: ProviderAuthSummary["methods"][number] = {
					type: "oauth",
					label: auth.oauth.loginLabel ?? auth.oauth.name,
				};
				if (auth.oauth.isSubscription) m.subscription = true;
				methods.push(m);
			}
			const summary: ProviderAuthSummary = { id: provider.id, name: provider.name, methods };
			try {
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), 5_000);
				const check = await rt.checkAuth(provider.id, { signal: controller.signal });
				clearTimeout(timer);
				if (check) {
					summary.status = { type: check.type };
					if (check.source !== undefined) summary.status.source = check.source;
				}
			} catch {
				// unknown status
			}
			return summary;
		}),
	);
	return summaries.sort((a, b) => (a.status ? 0 : 1) - (b.status ? 0 : 1) || a.name.localeCompare(b.name));
}

export async function login(
	providerId: string,
	method: "api_key" | "oauth",
	interaction: SdkAuthInteraction,
): Promise<void> {
	const rt = await runtime();
	await rt.login(providerId, method, interaction);
	modelsCache = undefined;
}

export async function logout(providerId: string): Promise<void> {
	const rt = await runtime();
	await rt.logout(providerId);
	modelsCache = undefined;
}

// ---------------------------------------------------------------------------
// Project trust: pi loads project-local extensions/skills/prompts only from
// trusted directories. Sessions pick the decision up when they start.
// ---------------------------------------------------------------------------

export interface TrustState {
	cwd: string;
	decision: boolean | null;
	hasProjectResources: boolean;
}

function trustStore(): ProjectTrustStore {
	return new ProjectTrustStore(getAgentDir());
}

export function readTrust(cwd: string): TrustState {
	return { cwd, decision: trustStore().get(cwd), hasProjectResources: hasTrustRequiringProjectResources(cwd) };
}

export function writeTrust(cwd: string, decision: boolean | null): TrustState {
	trustStore().set(cwd, decision);
	log.info(`project trust for ${cwd}: ${decision === null ? "undecided" : decision}`);
	return readTrust(cwd);
}

/** pi's session directory for a working directory, mirroring pi's own slug rule. */
export function sessionDirFor(cwd: string): string {
	const slug = cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
	return join(getAgentDir(), "sessions", `--${slug}--`);
}

/** pi's own changelog, for the GUI's "What's new" view. */
export function readChangelog(): { version: string; markdown: string } {
	const candidates = [join(getPackageDir(), "CHANGELOG.md"), join(getPackageDir(), "..", "CHANGELOG.md")];
	for (const path of candidates) {
		try {
			return { version: piVersion, markdown: readFileSync(path, "utf8") };
		} catch {
			// try the next candidate
		}
	}
	return { version: piVersion, markdown: "" };
}

/** pi's `retry.enabled` setting; pi does not report it in its RPC state. */
export function autoRetryEnabled(cwd: string): boolean {
	try {
		return SettingsManager.create(cwd, getAgentDir()).getRetryEnabled();
	} catch (error) {
		log.warn(`cannot read retry.enabled: ${(error as Error).message}`);
		return true;
	}
}

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigDocument, TrustInfo } from "@pi-tau/shared";
import { beforeAll, describe, expect, it } from "vitest";

// getAgentDir() honours PI_CODING_AGENT_DIR, so global-scope reads and the trust
// store stay inside a temp directory for these tests.
const agentDir = mkdtempSync(join(tmpdir(), "tau-agent-"));
const projectDir = mkdtempSync(join(tmpdir(), "tau-project-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

let registry: import("../src/session/registry.js").SessionRegistry;

beforeAll(async () => {
	const { SessionRegistry } = await import("../src/session/registry.js");
	registry = new SessionRegistry({ defaultCwd: projectDir, idleTimeoutMs: 0, piArgs: [], hostVersion: "test" });
});

describe("config commands", () => {
	it("reports a missing project file, writes it and reads it back", async () => {
		const missing = (await registry.execute({
			type: "config.read",
			file: "settings",
			scope: "project",
			cwd: projectDir,
		})) as ConfigDocument;
		expect(missing.exists).toBe(false);
		expect(missing.content).toBe("");
		expect(missing.path).toBe(join(projectDir, ".pi", "settings.json"));

		const written = (await registry.execute({
			type: "config.write",
			file: "settings",
			scope: "project",
			cwd: projectDir,
			content: '{ "theme": "dark" }',
		})) as ConfigDocument;
		expect(written.exists).toBe(true);
		expect(readFileSync(written.path, "utf8")).toBe('{ "theme": "dark" }\n');

		const reread = (await registry.execute({
			type: "config.read",
			file: "settings",
			scope: "project",
			cwd: projectDir,
		})) as ConfigDocument;
		expect(reread.exists).toBe(true);
		expect(JSON.parse(reread.content)).toEqual({ theme: "dark" });
	});

	it("refuses invalid JSON without touching the file", async () => {
		const path = join(projectDir, ".pi", "models.json");
		writeFileSync(path, '{"providers":{}}\n');
		await expect(
			registry.execute({ type: "config.write", file: "models", scope: "project", cwd: projectDir, content: "{oops" }),
		).rejects.toThrow(/not valid JSON/);
		expect(readFileSync(path, "utf8")).toBe('{"providers":{}}\n');
	});

	it("resolves the global scope inside the agent directory", async () => {
		const doc = (await registry.execute({
			type: "config.read",
			file: "keybindings",
			scope: "global",
		})) as ConfigDocument;
		expect(doc.path.startsWith(agentDir)).toBe(true);
	});
});

describe("project trust", () => {
	it("round-trips a decision and can clear it", async () => {
		const before = (await registry.execute({ type: "trust.get", cwd: projectDir })) as TrustInfo;
		expect(before.decision).toBeNull();
		const trusted = (await registry.execute({ type: "trust.set", cwd: projectDir, trusted: true })) as TrustInfo;
		expect(trusted.decision).toBe(true);
		const rejected = (await registry.execute({ type: "trust.set", cwd: projectDir, trusted: false })) as TrustInfo;
		expect(rejected.decision).toBe(false);
		const cleared = (await registry.execute({ type: "trust.set", cwd: projectDir, trusted: null })) as TrustInfo;
		expect(cleared.decision).toBeNull();
		expect(typeof cleared.hasProjectResources).toBe("boolean");
	});
});

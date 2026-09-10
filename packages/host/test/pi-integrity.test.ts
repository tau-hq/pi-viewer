/**
 * Guards the seam to pi. When a pi upgrade breaks one of these, fix the host before shipping.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as pi from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { RpcProcess, resolvePiCli } from "../src/pi/rpc-process.js";

const here = dirname(fileURLToPath(import.meta.url));
const pinned = (
	JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { dependencies: Record<string, string> }
).dependencies["@earendil-works/pi-coding-agent"];

describe("pi integrity", () => {
	it("installed pi matches the pinned version", () => {
		expect(pi.VERSION).toBe(pinned);
	});

	it("exports the SDK members the host relies on", () => {
		expect(typeof pi.getAgentDir).toBe("function");
		expect(typeof pi.SessionManager.listAll).toBe("function");
		expect(typeof pi.ModelRuntime.create).toBe("function");
		expect(typeof pi.SettingsManager.create).toBe("function");
	});

	it("resolves the RPC entry point", () => {
		expect(resolvePiCli()).toMatch(/pi-coding-agent/);
	});

	it("starts pi in RPC mode and answers get_state (no model needed)", async () => {
		const rpc = new RpcProcess({ cwd: process.cwd(), args: ["--no-session"] });
		rpc.start();
		try {
			const state = await rpc.request<{ sessionId: string; isStreaming: boolean }>({ type: "get_state" }, 60_000);
			expect(typeof state.sessionId).toBe("string");
			expect(state.isStreaming).toBe(false);
			const commands = await rpc.request<{ commands: unknown[] }>({ type: "get_commands" });
			expect(Array.isArray(commands.commands)).toBe(true);
		} finally {
			await rpc.stop(2_000);
		}
	}, 90_000);
});

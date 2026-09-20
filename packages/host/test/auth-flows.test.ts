import type { HostEnvelope } from "@pi-tau/shared";
import { describe, expect, it, vi } from "vitest";
import { AuthFlows, type LoginFunction } from "../src/session/auth-flows.js";

function collector(): { sent: HostEnvelope[]; emit: (env: HostEnvelope) => void } {
	const sent: HostEnvelope[] = [];
	return { sent, emit: (env) => sent.push(env) };
}

describe("AuthFlows", () => {
	it("relays prompts and events, resolves answers and reports success", async () => {
		const { sent, emit } = collector();
		const fakeLogin: LoginFunction = async (_provider, _method, interaction) => {
			interaction.notify({ type: "info", message: "hello" });
			const key = await interaction.prompt({ type: "secret", message: "key?" });
			expect(key).toBe("sk-test");
		};
		const flows = new AuthFlows(fakeLogin);
		const { flowId } = flows.start("acme", "api_key", emit);
		await vi.waitFor(() => expect(sent.some((e) => e.type === "auth.prompt")).toBe(true));
		const prompt = sent.find((e) => e.type === "auth.prompt");
		if (prompt?.type !== "auth.prompt") throw new Error("no prompt");
		expect(prompt.prompt).toEqual({ type: "secret", message: "key?" });
		expect(sent.find((e) => e.type === "auth.event")).toMatchObject({ event: { type: "info", message: "hello" } });
		flows.answer(flowId, prompt.promptId, "sk-test");
		await vi.waitFor(() => expect(sent.some((e) => e.type === "auth.done")).toBe(true));
		expect(sent.find((e) => e.type === "auth.done")).toMatchObject({ ok: true });
	});

	it("cancel aborts the flow and rejects pending prompts", async () => {
		const { sent, emit } = collector();
		const fakeLogin: LoginFunction = async (_p, _m, interaction) => {
			await interaction.prompt({ type: "text", message: "code?" });
		};
		const flows = new AuthFlows(fakeLogin);
		const { flowId } = flows.start("x", "oauth", emit);
		await vi.waitFor(() => expect(sent.some((e) => e.type === "auth.prompt")).toBe(true));
		flows.cancel(flowId);
		await vi.waitFor(() => expect(sent.some((e) => e.type === "auth.done")).toBe(true));
		expect(sent.find((e) => e.type === "auth.done")).toMatchObject({ ok: false, cancelled: true });
		expect(() => flows.answer(flowId, "nope", "x")).toThrow();
	});

	it("reports login errors", async () => {
		const { sent, emit } = collector();
		const fakeLogin = vi.fn<LoginFunction>().mockRejectedValue(new Error("boom"));
		new AuthFlows(fakeLogin).start("x", "api_key", emit);
		await vi.waitFor(() => expect(sent.some((e) => e.type === "auth.done")).toBe(true));
		expect(sent.find((e) => e.type === "auth.done")).toMatchObject({ ok: false, error: "boom" });
	});

	it("cancels flows of a disconnected client", async () => {
		const { sent, emit } = collector();
		const fakeLogin: LoginFunction = async (_p, _m, interaction) => {
			await interaction.prompt({ type: "text", message: "code?" });
		};
		const flows = new AuthFlows(fakeLogin);
		flows.start("x", "oauth", emit);
		await vi.waitFor(() => expect(sent.some((e) => e.type === "auth.prompt")).toBe(true));
		flows.cancelAllFor(emit);
		await vi.waitFor(() => expect(sent.some((e) => e.type === "auth.done")).toBe(true));
	});
});

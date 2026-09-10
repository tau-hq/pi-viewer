import type { AuthProviderInfo } from "@pi-tau/shared";
import { describe, expect, it } from "vitest";
import { sortProviders } from "./auth-store";

function provider(id: string, name: string, status?: AuthProviderInfo["status"]): AuthProviderInfo {
	return { id, name, methods: [{ type: "api_key", label: "API key" }], ...(status ? { status } : {}) };
}

describe("sortProviders", () => {
	it("puts configured providers first and sorts the rest by name", () => {
		const sorted = sortProviders([
			provider("openai", "OpenAI"),
			provider("vendor", "Vendor"),
			provider("nebius", "Nebius", { type: "api_key", source: "configured API key" }),
			provider("zai", "Z.ai"),
		]);
		expect(sorted.map((p) => p.id)).toEqual(["nebius", "vendor", "openai", "zai"]);
	});

	it("does not modify the input", () => {
		const input = [provider("b", "B"), provider("a", "A")];
		expect(sortProviders(input).map((p) => p.id)).toEqual(["a", "b"]);
		expect(input.map((p) => p.id)).toEqual(["b", "a"]);
	});
});

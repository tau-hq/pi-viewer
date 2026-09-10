import { describe, expect, it } from "vitest";
import {
	type AdvancedOptionsState,
	buildSessionOptions,
	countAdvancedOptions,
	EMPTY_ADVANCED_OPTIONS,
	removeAt,
	replaceAt,
} from "./session-options";

function state(patch: Partial<AdvancedOptionsState>): AdvancedOptionsState {
	return { ...EMPTY_ADVANCED_OPTIONS, ...patch };
}

describe("buildSessionOptions", () => {
	it("stays undefined while nothing is set", () => {
		expect(buildSessionOptions(EMPTY_ADVANCED_OPTIONS)).toBeUndefined();
		// Ticked tools without the restriction switch are not an allow-list yet.
		expect(buildSessionOptions(state({ tools: ["read"] }))).toBeUndefined();
		expect(countAdvancedOptions(EMPTY_ADVANCED_OPTIONS)).toBe(0);
	});

	it("sends an allow-list only when the restriction is on, empty list included", () => {
		expect(buildSessionOptions(state({ restrictTools: true, tools: ["read"] }))).toEqual({ tools: ["read"] });
		expect(buildSessionOptions(state({ restrictTools: true }))).toEqual({ tools: [] });
	});

	it("trims text and drops empty extension rows", () => {
		expect(
			buildSessionOptions(
				state({
					systemPrompt: "  be brief  ",
					appendSystemPrompt: "   ",
					extensions: [" /srv/x.ts ", "", "   "],
				}),
			),
		).toEqual({ systemPrompt: "be brief", extensions: ["/srv/x.ts"] });
	});

	it("passes the switches and the thinking level through", () => {
		const options = buildSessionOptions(
			state({ noContextFiles: true, ephemeral: true, thinkingLevel: "high", excludeTools: ["bash"] }),
		);
		expect(options).toEqual({ noContextFiles: true, ephemeral: true, thinkingLevel: "high", excludeTools: ["bash"] });
		expect(countAdvancedOptions(state({ ephemeral: true }))).toBe(1);
	});
});

describe("row helpers", () => {
	it("replaces and removes by index", () => {
		expect(replaceAt(["a", "b"], 1, "c")).toEqual(["a", "c"]);
		expect(removeAt(["a", "b", "c"], 0)).toEqual(["b", "c"]);
	});
});

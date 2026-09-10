import type { TrustInfo } from "@pi-tau/shared";
import { describe, expect, it } from "vitest";
import { needsTrustDecision } from "./trust-store";

function info(partial: Partial<TrustInfo>): TrustInfo {
	return { cwd: "/srv/project", decision: null, hasProjectResources: false, ...partial };
}

describe("needsTrustDecision", () => {
	it("asks when a project ships resources and nobody decided", () => {
		expect(needsTrustDecision(info({ hasProjectResources: true, decision: null }))).toBe(true);
	});

	it("stays quiet for a project without own resources", () => {
		expect(needsTrustDecision(info({ hasProjectResources: false, decision: null }))).toBe(false);
	});

	it("stays quiet once a decision exists", () => {
		expect(needsTrustDecision(info({ hasProjectResources: true, decision: true }))).toBe(false);
		expect(needsTrustDecision(info({ hasProjectResources: true, decision: false }))).toBe(false);
	});

	it("stays quiet while the host has not answered", () => {
		expect(needsTrustDecision(undefined)).toBe(false);
	});
});

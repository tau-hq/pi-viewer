import { defineConfig } from "@playwright/test";

/**
 * End-to-end suite against the running Tau host (systemd service on 8787, real pi + LLM).
 * No webServer: the host must already be up and serving the built client.
 */
export default defineConfig({
	testDir: "./tests",
	outputDir: "./test-results",
	fullyParallel: false,
	workers: 1,
	// The three prompt-driven specs depend on a real model deciding to call a tool.
	// That is not deterministic, so allow one retry; everything else is deterministic.
	retries: 1,
	// LLM round trips take a while; each test waits for the composer to become idle again.
	timeout: 240_000,
	expect: { timeout: 20_000 },
	reporter: [["list"]],
	use: {
		baseURL: "http://127.0.0.1:8787",
		colorScheme: "dark",
		viewport: { width: 1400, height: 900 },
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
});

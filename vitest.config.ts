import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: ["packages/host", "packages/client"],
	},
});

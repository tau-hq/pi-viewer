import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
	plugins: [react(), tailwindcss()],
	resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
	server: {
		port: 5173,
		strictPort: true,
		proxy: {
			"/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
			"/ws": { target: "ws://127.0.0.1:8787", ws: true },
		},
	},
	// Source maps only for development builds (`vite build --mode development`); the dev server always has them.
	build: { outDir: "dist", sourcemap: mode === "development" },
}));

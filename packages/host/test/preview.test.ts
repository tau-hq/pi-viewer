import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { previewSession } from "../src/session/preview.js";

const dir = mkdtempSync(join(tmpdir(), "tau-preview-"));

function write(name: string, lines: unknown[]): string {
	const path = join(dir, name);
	writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
	return path;
}

const base = { timestamp: "2026-09-11T10:00:00.000Z" };

describe("previewSession", () => {
	it("reads the conversation, the directory and the last settings from the file", () => {
		const path = write("session.jsonl", [
			{ type: "session", version: 3, cwd: "/srv/pi-tau" },
			{ ...base, id: "m1", parentId: null, type: "model_change", provider: "nebius", modelId: "glm-old" },
			{ ...base, id: "t1", parentId: "m1", type: "thinking_level_change", thinkingLevel: "low" },
			{ ...base, id: "a", parentId: "t1", type: "message", message: { role: "user", content: "hello" } },
			{ ...base, id: "m2", parentId: "a", type: "model_change", provider: "nebius", modelId: "glm-new" },
			{ ...base, id: "t2", parentId: "m2", type: "thinking_level_change", thinkingLevel: "high" },
		]);
		const preview = previewSession(path);
		expect(preview.cwd).toBe("/srv/pi-tau");
		// The last of each wins, exactly as replaying the file would leave it.
		expect(preview.model).toEqual({ provider: "nebius", modelId: "glm-new" });
		expect(preview.thinkingLevel).toBe("high");
		expect(preview.leafId).toBe("t2");
		expect(preview.messages.map((message) => message.role)).toEqual(["user"]);
	});

	it("takes the branch the last entry sits on, not the abandoned one", () => {
		const path = write("branched.jsonl", [
			{ type: "session", version: 3, cwd: "/srv" },
			{ ...base, id: "a", parentId: null, type: "message", message: { role: "user", content: "first" } },
			{ ...base, id: "b", parentId: "a", type: "message", message: { role: "user", content: "abandoned" } },
			{ ...base, id: "c", parentId: "a", type: "message", message: { role: "user", content: "kept" } },
		]);
		const texts = previewSession(path).messages.map((message) =>
			message.role === "user" ? message.content.map((block) => (block.type === "text" ? block.text : "")).join("") : "",
		);
		expect(texts).toEqual(["first", "kept"]);
	});

	it("ignores a half-written last line instead of failing", () => {
		const path = join(dir, "partial.jsonl");
		writeFileSync(
			path,
			`${JSON.stringify({ type: "session", version: 3, cwd: "/srv" })}\n${JSON.stringify({ ...base, id: "a", parentId: null, type: "message", message: { role: "user", content: "done" } })}\n{"id":"b","par`,
		);
		expect(previewSession(path).messages).toHaveLength(1);
	});
});

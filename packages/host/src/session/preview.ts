import { readFileSync } from "node:fs";
import type { Message } from "@pi-tau/shared";
import { createLogger } from "../logger.js";
import type { PiEntry } from "../pi/rpc-types.js";
import { entriesToTranscript } from "./translate.js";

const log = createLogger("preview");

export interface SessionPreview {
	messages: Message[];
	leafId?: string;
	cwd?: string;
	model?: { provider: string; modelId: string };
	thinkingLevel?: string;
}

function isEntry(value: unknown): value is PiEntry {
	const entry = value as PiEntry;
	return typeof entry?.id === "string" && typeof entry.type === "string";
}

/**
 * The conversation as it stands in pi's session file, without starting pi. Reading a session
 * costs nothing; a process is only needed to continue one. The client shows this at once and
 * replaces it with the authoritative transcript as soon as the process has attached.
 *
 * The branch is taken from the last entry in the file, which is where pi itself resumes.
 */
export function previewSession(sessionPath: string): SessionPreview {
	const text = readFileSync(sessionPath, "utf8");
	const entries: PiEntry[] = [];
	let cwd: string | undefined;
	let model: { provider: string; modelId: string } | undefined;
	let thinkingLevel: string | undefined;
	for (const line of text.split("\n")) {
		if (line.length === 0) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			// A half-written last line is normal while pi is appending; everything before it stands.
			continue;
		}
		const record = parsed as { type?: string; cwd?: string };
		if (record.type === "session") {
			if (typeof record.cwd === "string") cwd = record.cwd;
			continue;
		}
		if (!isEntry(parsed)) continue;
		entries.push(parsed);
		// The last one of each wins, exactly as replaying the file would leave it.
		if (parsed.type === "model_change") model = { provider: parsed.provider, modelId: parsed.modelId };
		if (parsed.type === "thinking_level_change") thinkingLevel = parsed.thinkingLevel;
	}
	const leafId = entries.at(-1)?.id;
	const preview: SessionPreview = { messages: entriesToTranscript(entries, leafId) };
	if (leafId !== undefined) preview.leafId = leafId;
	if (cwd !== undefined) preview.cwd = cwd;
	if (model !== undefined) preview.model = model;
	if (thinkingLevel !== undefined) preview.thinkingLevel = thinkingLevel;
	log.info(`preview of ${sessionPath}: ${preview.messages.length} messages from ${entries.length} entries`);
	return preview;
}

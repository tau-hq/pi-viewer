import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { collectErrors, composer, deleteE2eSessions, e2eSessionName, openApp, stopSessionProcess } from "./helpers";

/**
 * Opening a session must not wait for pi to start. The host reads the conversation out of the
 * session file in a few milliseconds; the process attaches behind it.
 *
 * The session is imported from a file rather than typed: pi writes a session file on the first
 * real turn, and this suite must not spend an LLM call on getting one.
 */
test.describe.configure({ mode: "serial" });

const CWD = "/srv/pi-tau";
const SESSION_NAME = e2eSessionName("preview");
const MARKER = "tau-preview-marker";

let page: Page;
let errors: string[];
let sessionPath: string;

test.beforeAll(async ({ browser }) => {
	page = await browser.newPage();
	errors = collectErrors(page);
	await openApp(page);

	const id = randomUUID();
	const timestamp = new Date().toISOString();
	const entries = [
		{ type: "session", version: 3, id, timestamp, cwd: CWD },
		{ type: "session_info", id: "preview-info", parentId: null, timestamp, name: SESSION_NAME },
		{
			type: "message",
			id: "preview-message",
			parentId: "preview-info",
			timestamp,
			message: { role: "user", content: [{ type: "text", text: MARKER }], timestamp: Date.now() },
		},
	];
	const file = join(mkdtempSync(join(tmpdir(), "tau-e2e-preview-")), `${id}.jsonl`);
	writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);

	sessionPath = await page.evaluate(async (sourcePath) => {
		const socket = new WebSocket(`ws://${location.host}/ws`);
		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => resolve();
			socket.onerror = () => reject(new Error("host socket failed"));
		});
		socket.send(JSON.stringify({ type: "hello", protocolVersion: 1 }));
		const answer = await new Promise<{ path?: string; sessionId?: string }>((resolve) => {
			socket.onmessage = (event) => {
				const envelope = JSON.parse(String(event.data)) as { type?: string; id?: string; data?: unknown };
				if (envelope.type === "result" && envelope.id === "import") resolve((envelope.data ?? {}) as { path?: string });
			};
			socket.send(JSON.stringify({ type: "cmd", id: "import", command: { type: "sessions.import", sourcePath } }));
		});
		socket.close();
		return answer.path ?? "";
	}, file);
	expect(sessionPath.length).toBeGreaterThan(0);
});

test.afterAll(async () => {
	await deleteE2eSessions(page);
	await page.close();
});

test("a session without a running process shows its conversation before pi has started", async () => {
	await stopSessionProcess(page, sessionPath);
	await page.reload({ waitUntil: "networkidle" });
	await expect(page.getByRole("button", { name: /New session/ }).first()).toBeVisible();

	await page.getByTestId("session-item").filter({ hasText: SESSION_NAME }).first().click();
	// The conversation is there while the header still says the process is starting; that is
	// only possible because the transcript came from the file and not from pi.
	await expect(page.locator("header")).toContainText("Starting", { timeout: 5_000 });
	await expect(page.locator("main")).toContainText(MARKER);

	// And once pi has attached, the composer takes messages again, and the footer carries the
	// session's numbers without waiting for a first run.
	await expect(page.locator("header")).not.toContainText("Starting", { timeout: 30_000 });
	await expect(composer(page)).toBeEnabled();
	await expect(page.locator("main")).toContainText(MARKER);
	await expect(page.locator("footer")).toContainText("%", { timeout: 15_000 });
	expect(errors).toEqual([]);
});

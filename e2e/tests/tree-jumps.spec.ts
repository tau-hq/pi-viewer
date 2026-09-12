import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { collectErrors, composer, deleteE2eSessions, e2eSessionName, openApp } from "./helpers";

/**
 * The session tree only lets the conversation stand where it really stood: just before a user
 * message, or at the end of a branch. It never cuts an answer in two - an assistant message kept
 * without its tool results would reach the model as a failed call. The session is imported from
 * a file with one real tool round, so no model is needed.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = "/srv/pi-tau/e2e/shots";
const SESSION_NAME = e2eSessionName("jumps");

let page: Page;
let errors: string[];

function fixture(): string {
	const id = randomUUID();
	const at = new Date().toISOString();
	const now = Date.now();
	const assistant = (entryId: string, parentId: string, content: unknown[]) => ({
		type: "message",
		id: entryId,
		parentId,
		timestamp: at,
		message: {
			role: "assistant",
			content,
			provider: "nebius",
			model: "glm",
			usage: {},
			stopReason: "stop",
			timestamp: now,
		},
	});
	const user = (entryId: string, parentId: string, text: string) => ({
		type: "message",
		id: entryId,
		parentId,
		timestamp: at,
		message: { role: "user", content: [{ type: "text", text }], timestamp: now },
	});
	const entries = [
		{ type: "session", version: 3, id, timestamp: at, cwd: "/srv/pi-tau" },
		{ type: "session_info", id: "info", parentId: null, timestamp: at, name: SESSION_NAME },
		user("ask-one", "info", "tau-question-one"),
		assistant("call", "ask-one", [{ type: "toolCall", id: "tc1", name: "ls", arguments: { path: "." } }]),
		{
			type: "message",
			id: "result",
			parentId: "call",
			timestamp: at,
			message: {
				role: "toolResult",
				toolCallId: "tc1",
				toolName: "ls",
				content: [{ type: "text", text: "README.md" }],
				isError: false,
				timestamp: now,
			},
		},
		assistant("answer-one", "result", [{ type: "text", text: "tau-answer-one" }]),
		user("ask-two", "answer-one", "tau-question-two"),
		assistant("answer-two", "ask-two", [{ type: "text", text: "tau-answer-two" }]),
	];
	const file = join(mkdtempSync(join(tmpdir(), "tau-e2e-jumps-")), `${id}.jsonl`);
	writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
	return file;
}

test.beforeAll(async ({ browser }) => {
	page = await browser.newPage();
	errors = collectErrors(page);
	await openApp(page);
	await page.evaluate(async (sourcePath) => {
		const socket = new WebSocket(`ws://${location.host}/ws`);
		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => resolve();
			socket.onerror = () => reject(new Error("host socket failed"));
		});
		socket.send(JSON.stringify({ type: "hello", protocolVersion: 1 }));
		await new Promise<void>((resolve) => {
			socket.onmessage = (event) => {
				const envelope = JSON.parse(String(event.data)) as { type?: string; id?: string };
				if (envelope.type === "result" && envelope.id === "import") resolve();
			};
			socket.send(JSON.stringify({ type: "cmd", id: "import", command: { type: "sessions.import", sourcePath } }));
		});
		socket.close();
	}, fixture());
	await page.reload({ waitUntil: "networkidle" });
	await page.getByTestId("session-item").filter({ hasText: SESSION_NAME }).first().click();
	await expect(page.locator("main")).toContainText("tau-answer-two", { timeout: 30_000 });
});

test.afterAll(async () => {
	await deleteE2eSessions(page);
	await page.close();
});

test("only the place before a user message and the end of a branch can be picked", async () => {
	await page.getByRole("button", { name: "Session tree" }).click();
	const dialog = page.getByTestId("tree-dialog");
	await expect(dialog).toBeVisible();
	const row = (text: string) => dialog.getByTestId("tree-row").filter({ hasText: text }).first();

	await expect(row("tau-question-one")).toHaveAttribute("data-jump", "beforeMessage");
	await expect(row("tau-question-two")).toHaveAttribute("data-jump", "beforeMessage");
	// The middle of an answer - the tool call, its result, the text after it - is only to be read.
	await expect(row("[ls]")).not.toHaveAttribute("data-jump", /./);
	await expect(row("README.md")).not.toHaveAttribute("data-jump", /./);
	await expect(row("tau-answer-one")).not.toHaveAttribute("data-jump", /./);
	await expect(row("tau-answer-one").getByRole("button").last()).toBeDisabled();
	await page.screenshot({ path: `${SHOTS}/152-tree-jumps.png`, animations: "disabled" });
});

test("jumping before a message keeps the answer before it whole and gives the message back", async () => {
	const dialog = page.getByTestId("tree-dialog");
	await dialog
		.getByTestId("tree-row")
		.filter({ hasText: "tau-question-two" })
		.first()
		.getByRole("button")
		.last()
		.click();
	await expect(dialog).toBeHidden();

	const main = page.locator("main");
	await expect(main).not.toContainText("tau-answer-two", { timeout: 30_000 });
	await expect(main).toContainText("tau-answer-one");
	// Exactly what the fork dialog does: the message is back in the composer, ready to change.
	await expect(composer(page)).toHaveValue("tau-question-two");
	await composer(page).fill("");
});

test("a search hit on the abandoned branch lands at the end of its answer", async () => {
	await page.keyboard.press("Control+f");
	await page.getByTestId("search-input").fill("tau-answer-two");
	const hit = page.getByTestId("search-results").getByTestId("search-result").first();
	await expect(hit).toHaveAttribute("title", /another branch/);
	await hit.click();
	await expect(page.locator("main")).toContainText("tau-answer-two", { timeout: 30_000 });
	await expect(page.locator("main")).toContainText("tau-question-two");
	// Landing at the end of the answer, not on the question: nothing is put into the composer.
	await expect(composer(page)).toHaveValue("");
	expect(errors).toEqual([]);
});

import { expect, type Page, test } from "@playwright/test";
import { collectErrors, composer, deleteE2eSessions, e2eSessionName, openApp, queueMessages, toasts } from "./helpers";

/**
 * The last interactive gaps against pi's terminal UI: `@` file mentions, the copy button of a
 * single message and taking a queued message back into the composer. One session for the whole
 * file and no LLM prompt: the file search runs on the host, `!` runs a shell command without a
 * model, and steering messages queue while pi is idle.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = "/srv/pi-tau/e2e/shots";
const SESSION_NAME = e2eSessionName("composer");
const PROTOCOL = "packages/shared/src/protocol.ts";

let page: Page;
let errors: string[];

test.beforeAll(async ({ browser }) => {
	// The copy button writes to the clipboard, which headless Chromium only allows when asked.
	const context = await browser.newContext({
		baseURL: "http://127.0.0.1:8787",
		viewport: { width: 1400, height: 900 },
		colorScheme: "dark",
	});
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	page = await context.newPage();
	errors = collectErrors(page);
	await openApp(page);
	await page
		.getByRole("button", { name: /New session/ })
		.first()
		.click();
	await expect(page.getByLabel("Working directory")).toBeVisible();
	await page.getByRole("button", { name: "Create", exact: true }).click();
	await expect(composer(page)).toBeVisible({ timeout: 30_000 });
	await composer(page).fill(`/name ${SESSION_NAME}`);
	await composer(page).press("Enter");
	await expect(page.locator("header").getByText(SESSION_NAME)).toBeVisible();
});

test.afterAll(async () => {
	// A run must not leave sessions behind; the helper only deletes what this suite named.
	await deleteE2eSessions(page);
	await page.close();
});

test("@ completes a project file and inserts its path", async () => {
	// Hovering an entry moves the highlight, so keep the pointer out of the popup.
	await page.mouse.move(2, 2);
	await composer(page).fill("@prot");
	const menu = page.getByTestId("mention-menu");
	await expect(menu).toBeVisible();
	const items = menu.getByTestId("mention-item");
	// The host's search is gitignore aware and ranks a hit in the file name first.
	await expect(items.first()).toContainText("protocol.ts");
	await expect(items.first()).toContainText("packages/shared/src/");
	await expect(items.first()).toHaveAttribute("aria-selected", "true");
	await page.screenshot({ path: `${SHOTS}/100-mention-menu.png`, animations: "disabled" });

	// The arrow keys move the highlight, Enter takes it.
	await composer(page).press("ArrowDown");
	await expect(items.nth(1)).toHaveAttribute("aria-selected", "true");
	await composer(page).press("ArrowUp");
	await expect(items.first()).toHaveAttribute("aria-selected", "true");
	await composer(page).press("Enter");
	// Only the path is inserted; the model reads the file itself.
	await expect(composer(page)).toHaveValue(`@${PROTOCOL} `);
	await expect(menu).toBeHidden();
});

test("accepting a directory drills down, Esc closes and a miss says so", async () => {
	await composer(page).fill("@packages/cli");
	const menu = page.getByTestId("mention-menu");
	const items = menu.getByTestId("mention-item");
	await expect(items.first()).toContainText("client/");
	await page.screenshot({ path: `${SHOTS}/101-mention-directory.png`, animations: "disabled" });

	// A directory keeps the popup open with its own content, so the next level can be picked.
	await items.first().click();
	await expect(composer(page)).toHaveValue("@packages/client/");
	await expect(menu).toBeVisible();
	await expect(items.first()).toContainText("/");
	await expect(menu).toContainText("packages/client/");

	// Esc closes the popup and leaves the typed text alone.
	await composer(page).press("Escape");
	await expect(menu).toBeHidden();
	await expect(composer(page)).toHaveValue("@packages/client/");

	await composer(page).fill("@zzzznope");
	await expect(menu).toBeVisible();
	await expect(menu).toContainText("No matching files");
	await page.screenshot({ path: `${SHOTS}/102-mention-empty.png`, animations: "disabled" });

	// A command at the start of the line stays command completion.
	await composer(page).fill("/comp");
	await expect(menu).toBeHidden();
	await expect(page.getByRole("listbox")).toContainText("/compact");
	await composer(page).fill("");
});

test("the copy button of a message puts its text on the clipboard", async () => {
	await composer(page).fill("!echo tau-copy-row");
	await composer(page).press("Enter");
	await expect(page.locator("main")).toContainText("tau-copy-row", { timeout: 30_000 });

	const copy = page.getByTestId("message-copy").last();
	await copy.click();
	// The state flips only when the browser accepted the write.
	await expect(copy).toHaveAttribute("data-copied", "true");
	await page.screenshot({ path: `${SHOTS}/103-message-copy.png`, animations: "disabled" });

	// A shell card copies its command plus the output.
	const clipboard = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
	expect(clipboard).toBe("echo tau-copy-row\ntau-copy-row");
	// The feedback goes away on its own.
	await expect(copy).toHaveAttribute("data-copied", "false");
});

test("a queued message can be taken back into the composer", async () => {
	await queueMessages(page, SESSION_NAME, ["queued first", "queued second"], []);
	const entries = page.getByTestId("queue-entry");
	await expect(entries).toHaveCount(2);

	// Edit removes the entry through the same clear-and-requeue path the X uses.
	await entries.nth(0).getByTestId("queue-entry-edit").click();
	await expect(entries).toHaveCount(1);
	await expect(entries.first()).toContainText("queued second");
	await expect(toasts(page)).toContainText("Entry removed from the queue");
	await expect(composer(page)).toHaveValue("queued first");
	await expect(composer(page)).toBeFocused();
	await page.screenshot({ path: `${SHOTS}/104-queue-edit.png`, animations: "disabled" });

	// A draft in the composer survives: the second entry lands on a line of its own.
	await entries.first().getByTestId("queue-entry-edit").click();
	await expect(page.getByTestId("queue-panel")).toBeHidden();
	await expect(composer(page)).toHaveValue("queued first\nqueued second");
	await page.screenshot({ path: `${SHOTS}/105-queue-edit-appended.png`, animations: "disabled" });
	await composer(page).fill("");
	expect(errors).toEqual([]);
});

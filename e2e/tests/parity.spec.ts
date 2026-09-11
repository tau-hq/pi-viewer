import { expect, type Page, test } from "@playwright/test";
import {
	collectErrors,
	composer,
	deleteE2eSessions,
	e2eSessionName,
	openApp,
	queueMessages,
	runShell,
	toasts,
} from "./helpers";

/**
 * The small parity features: session settings, hotkeys, changelog, tree filters, queue entries,
 * import, scoped models and the catalog refresh. One session for the whole file and no LLM
 * prompt: steering messages queue while pi is idle, and `!` runs a shell command without a model.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = "/srv/pi-tau/e2e/shots";
const SESSION_NAME = e2eSessionName("parity");

let page: Page;
let errors: string[];

async function openMenu(testId: string): Promise<void> {
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByTestId(testId).click();
}

/** Move the focus out of the composer so single-key shortcuts reach the window. */
async function blurComposer(): Promise<void> {
	await page.locator("header").click({ position: { x: 4, y: 4 } });
}

test.beforeAll(async ({ browser }) => {
	page = await browser.newPage();
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

test("session settings switch the queue modes, compaction and retry", async () => {
	await openMenu("menu-session-settings");
	const dialog = page.getByTestId("session-settings-dialog");
	await expect(dialog).toBeVisible();
	// pi starts a session with one message per turn and automatic compaction on.
	await expect(page.getByTestId("setting-steering-mode-one-at-a-time")).toHaveAttribute("data-state", "active");
	await expect(page.getByTestId("setting-followup-mode-one-at-a-time")).toHaveAttribute("data-state", "active");
	await expect(dialog.locator("#setting-auto-compaction")).toHaveAttribute("aria-checked", "true");
	await expect(dialog.locator("#setting-auto-retry")).toHaveAttribute("aria-checked", "true");
	await expect(dialog).toContainText("after a reload it says on again");
	await expect(dialog).toContainText("also become the default for new sessions");

	// The host answers with a state update, so an active tab proves the command went through.
	await page.getByTestId("setting-steering-mode-all").click();
	await expect(page.getByTestId("setting-steering-mode-all")).toHaveAttribute("data-state", "active");
	await page.getByTestId("setting-followup-mode-all").click();
	await expect(page.getByTestId("setting-followup-mode-all")).toHaveAttribute("data-state", "active");
	await dialog.locator("#setting-auto-compaction").click();
	await expect(dialog.locator("#setting-auto-compaction")).toHaveAttribute("aria-checked", "false");
	await dialog.locator("#setting-auto-retry").click();
	await expect(dialog.locator("#setting-auto-retry")).toHaveAttribute("aria-checked", "false");
	await page.screenshot({ path: `${SHOTS}/80-session-settings.png`, animations: "disabled" });

	// Reopening reads the session state again: the switches must still be where they were left.
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await openMenu("menu-session-settings");
	await expect(page.getByTestId("setting-steering-mode-all")).toHaveAttribute("data-state", "active");
	await expect(dialog.locator("#setting-auto-compaction")).toHaveAttribute("aria-checked", "false");
	await expect(dialog.locator("#setting-auto-retry")).toHaveAttribute("aria-checked", "false");

	// Leave the session on pi's defaults again.
	await page.getByTestId("setting-steering-mode-one-at-a-time").click();
	await page.getByTestId("setting-followup-mode-one-at-a-time").click();
	await dialog.locator("#setting-auto-compaction").click();
	await dialog.locator("#setting-auto-retry").click();
	await expect(dialog.locator("#setting-auto-compaction")).toHaveAttribute("aria-checked", "true");
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("the hotkeys dialog opens from the menu and with ?", async () => {
	await openMenu("menu-hotkeys");
	const dialog = page.getByTestId("hotkeys-dialog");
	await expect(dialog).toBeVisible();
	for (const group of ["global", "composer", "dialogs", "terminal"]) {
		await expect(page.getByTestId(`hotkeys-group-${group}`)).toBeVisible();
	}
	// Rows come from the same table the handlers use, so the real keys are listed.
	const global = page.getByTestId("hotkeys-group-global");
	await expect(global.getByTestId("hotkey-row").filter({ hasText: "Jump to another session" })).toContainText(
		"Ctrl/⌘+K",
	);
	await expect(global.getByTestId("hotkey-row").filter({ hasText: "Abort the running turn" })).toContainText("Esc");
	await expect(global.getByTestId("hotkey-row").filter({ hasText: "Show this list" })).toContainText("?");
	const rows = await dialog.getByTestId("hotkey-row").count();
	expect(rows).toBeGreaterThan(10);
	await page.screenshot({ path: `${SHOTS}/81-hotkeys.png`, animations: "disabled" });
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();

	// ? opens it as long as the composer is empty and does not have the focus.
	await blurComposer();
	await page.keyboard.press("?");
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();

	// With text in the composer the key belongs to the editor.
	await composer(page).fill("draft");
	await composer(page).press("?");
	await expect(dialog).toBeHidden();
	await expect(composer(page)).toHaveValue("draft?");

	// The slash command reaches the same dialog and leaves the composer empty.
	await composer(page).fill("/hotkeys");
	await composer(page).press("Enter");
	await expect(dialog).toBeVisible();
	await expect(composer(page)).toHaveValue("");
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();

	// /session-settings routes to the settings dialog.
	await composer(page).fill("/session-settings");
	await composer(page).press("Enter");
	await expect(page.getByTestId("session-settings-dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("session-settings-dialog")).toBeHidden();
});

test("the changelog dialog renders pi's release notes", async () => {
	await openMenu("menu-changelog");
	const dialog = page.getByTestId("changelog-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole("heading").first()).toHaveText(/^pi \d+\.\d+\.\d+ changelog$/);
	await expect(dialog.locator(".md h2").first()).toBeVisible({ timeout: 30_000 });
	// Only the newest releases are rendered; pi ships far more than that.
	await expect(page.getByTestId("changelog-truncated")).toContainText(/Newest 200 of \d+ releases shown/);
	await page.screenshot({ path: `${SHOTS}/82-changelog.png`, animations: "disabled" });
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("tree filters narrow the entry list", async () => {
	// A shell command adds an entry without a model round trip.
	await runShell(page, "echo hello-tree");
	await expect(page.locator("main")).toContainText("hello-tree", { timeout: 30_000 });

	await page.getByRole("button", { name: "Session tree" }).click();
	const dialog = page.getByTestId("tree-dialog");
	await expect(dialog).toBeVisible();
	const rows = dialog.getByTestId("tree-row");
	// Model change, thinking level change, the rename and the shell run.
	await expect(rows.first()).toBeVisible();
	const all = await rows.count();
	expect(all).toBeGreaterThanOrEqual(3);
	await expect(page.getByTestId("tree-count")).toHaveText(`${all} of ${all} entries`);

	// Settings and bookkeeping entries go away, only the shell run stays.
	await page.getByTestId("tree-filter-no-tools").click();
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toContainText("echo hello-tree");
	await expect(page.getByTestId("tree-count")).toHaveText(`1 of ${all} entries`);
	await page.screenshot({ path: `${SHOTS}/83-tree-filters.png`, animations: "disabled" });

	await page.getByTestId("tree-filter-user-only").click();
	await expect(rows).toHaveCount(0);
	await expect(page.getByTestId("tree-empty")).toContainText("No entry matches this filter");

	await page.getByTestId("tree-filter-labeled-only").click();
	await expect(rows).toHaveCount(0);

	await page.getByTestId("tree-filter-all").click();
	await expect(rows).toHaveCount(all);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("queued entries can be removed one by one", async () => {
	await queueMessages(page, SESSION_NAME, ["queued one", "queued two"], ["queued three"]);
	const entries = page.getByTestId("queue-entry");
	await expect(entries).toHaveCount(3);
	await expect(entries.nth(0)).toContainText("Steering");
	await expect(entries.nth(2)).toContainText("Follow-up");
	await page.screenshot({ path: `${SHOTS}/84-queue-entries.png`, animations: "disabled" });

	// Removing clears the queue and sends the rest again; the order must survive.
	await entries.nth(1).getByTestId("queue-entry-remove").click();
	await expect(entries).toHaveCount(2);
	await expect(entries.nth(0)).toContainText("queued one");
	await expect(entries.nth(1)).toContainText("queued three");
	await expect(toasts(page)).toContainText("Entry removed from the queue");
	await page.screenshot({ path: `${SHOTS}/85-queue-after-removal.png`, animations: "disabled" });

	await entries.nth(1).getByTestId("queue-entry-remove").click();
	await expect(entries).toHaveCount(1);
	await expect(entries.first()).toContainText("queued one");

	await page.getByTestId("queue-clear").click();
	await expect(page.getByTestId("queue-panel")).toBeHidden();
});

test("copying the last answer says so when there is none", async () => {
	await openMenu("menu-copy-last");
	await expect(toasts(page)).toContainText("This session has no answer to copy yet");
});

test("the import dialog validates the path and reports the host's refusal", async () => {
	await page.getByTestId("sidebar-import").click();
	const dialog = page.getByTestId("import-session-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("import-session-path").fill("session.jsonl");
	await dialog.getByRole("button", { name: "Import", exact: true }).click();
	await expect(page.getByTestId("import-session-error")).toContainText("absolute path");

	await page.getByTestId("import-session-path").fill("/tmp/tau-does-not-exist.jsonl");
	await dialog.getByRole("button", { name: "Import", exact: true }).click();
	await expect(page.getByTestId("import-session-error")).toContainText("file not found");
	await page.screenshot({ path: `${SHOTS}/86-import-session.png`, animations: "disabled" });
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("scoped models list the catalog and save through settings.patch", async () => {
	await page.getByRole("button", { name: "Configuration", exact: true }).click();
	await expect(page.getByTestId("config-dialog")).toBeVisible();
	await expect(page.getByTestId("config-scoped-models")).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/89-config-entry.png`, animations: "disabled" });
	await page.getByTestId("config-scoped-models").click();
	const dialog = page.getByTestId("scoped-models-dialog");
	await expect(dialog).toBeVisible();
	const rows = dialog.getByTestId("scoped-model-row");
	await expect(rows.first()).toBeVisible();
	await expect(dialog.getByTestId("scoped-models-save")).toBeDisabled();

	// Selecting every model of the catalog is the same as selecting none, so pi's key is removed.
	const count = await rows.count();
	for (let index = 0; index < count; index++) await rows.nth(index).locator("input[type=checkbox]").check();
	await expect(rows.first()).toHaveAttribute("data-selected", "true");
	await page.screenshot({ path: `${SHOTS}/87-scoped-models.png`, animations: "disabled" });
	await dialog.getByTestId("scoped-models-save").click();
	await expect(toasts(page)).toContainText(/Saved to .*settings\.json/);
	await expect(dialog.getByTestId("scoped-models-save")).toBeDisabled();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("the model picker refreshes the catalog", async () => {
	// The model picker sits in the composer, next to the approval mode.
	await page
		.getByTestId("composer-tools")
		.getByRole("button", { name: /GLM|Model|No model/ })
		.first()
		.click();
	await page.getByTestId("models-refresh").click();
	await expect(toasts(page)).toContainText(/\d+ models in the catalog/, { timeout: 60_000 });
	await page.screenshot({ path: `${SHOTS}/88-model-refresh.png`, animations: "disabled" });
	await page.keyboard.press("Escape");
	expect(errors).toEqual([]);
});

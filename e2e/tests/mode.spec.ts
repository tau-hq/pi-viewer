import { expect, type Page, test } from "@playwright/test";
import { collectErrors, composer, deleteE2eSessions, e2eSessionName, openApp } from "./helpers";

// One session for the whole file and no LLM prompt: only the approval mode is exercised.
test.describe.configure({ mode: "serial" });

const SHOTS = "/srv/pi-tau/e2e/shots";
const SESSION_NAME = e2eSessionName("mode");

let page: Page;
let errors: string[];

/** Show the session this file created; after a reload the app starts on the session list again. */
async function openOwnSession(): Promise<void> {
	await expect(page.getByRole("button", { name: /New session/ }).first()).toBeVisible();
	await page.getByTestId("session-item").filter({ hasText: SESSION_NAME }).first().click();
	await expect(composer(page)).toBeVisible({ timeout: 30_000 });
	await expect(page.getByTestId("mode-trigger")).toBeVisible();
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

test("the menu lists the four modes and marks the active one", async () => {
	// The Tau extension is loaded, so the control is shown and starts on the default.
	await expect(page.getByTestId("mode-trigger")).toContainText("Manual");
	await expect(page.getByTestId("status-mode")).toHaveText("Manual");
	await page.getByTestId("mode-trigger").click();
	const menu = page.getByTestId("mode-menu");
	await expect(menu).toBeVisible();
	await expect(menu.getByTestId("mode-option-auto")).toContainText("Tau runs every tool without asking");
	await expect(menu.getByTestId("mode-option-acceptEdits")).toContainText(
		"Only dangerous shell commands need approval",
	);
	await expect(menu.getByTestId("mode-option-manual")).toContainText("Approve file changes and shell commands");
	await expect(menu.getByTestId("mode-option-strict")).toContainText("Approve every single tool call");
	// Only the active entry carries the check mark.
	await expect(menu.getByRole("menuitem", { name: /Manual/ }).locator("svg")).toHaveCount(1);
	await expect(menu.getByRole("menuitem", { name: /Strict/ }).locator("svg")).toHaveCount(0);
	await page.screenshot({ path: `${SHOTS}/70-mode-menu.png` });
});

test("picking Auto reaches the status bar and survives a reload", async () => {
	await page.getByTestId("mode-menu").getByTestId("mode-option-auto").click();
	await expect(page.getByTestId("mode-menu")).toBeHidden();
	await expect(page.getByTestId("mode-trigger")).toContainText("Auto");
	await expect(page.getByTestId("status-mode")).toHaveText("Auto");
	// Deliberately not highlighted: the mode reads exactly like everything around it.
	await expect(page.getByTestId("status-mode").locator("xpath=..")).not.toHaveClass(/text-|font-medium|font-bold/);
	await expect(page.getByTestId("mode-trigger")).not.toHaveClass(/font-medium|font-bold/);
	await page.screenshot({ path: `${SHOTS}/71-auto-mode.png` });

	// The host keeps the mode, so a fresh page shows it again.
	await page.reload({ waitUntil: "networkidle" });
	await openOwnSession();
	await expect(page.getByTestId("status-mode")).toHaveText("Auto");
	await expect(page.getByTestId("mode-trigger")).toContainText("Auto");
});

test("Shift+Tab cycles, a number key picks, and the session ends on Manual again", async () => {
	await composer(page).click();
	await composer(page).press("Shift+Tab");
	await expect(page.getByTestId("status-mode")).toHaveText("Accept edits");
	await composer(page).press("Shift+Tab");
	await expect(page.getByTestId("status-mode")).toHaveText("Manual");
	await composer(page).press("Shift+Tab");
	await expect(page.getByTestId("status-mode")).toHaveText("Strict");
	// Wraps around to the first entry.
	await composer(page).press("Shift+Tab");
	await expect(page.getByTestId("status-mode")).toHaveText("Auto");
	// 3 is Manual: leave the session guarded again.
	await page.getByTestId("mode-trigger").click();
	await expect(page.getByTestId("mode-menu")).toBeVisible();
	await page.keyboard.press("3");
	await expect(page.getByTestId("mode-menu")).toBeHidden();
	await expect(page.getByTestId("status-mode")).toHaveText("Manual");
	expect(errors).toEqual([]);
});

import { expect, type Page, test } from "@playwright/test";
import { collectErrors, composer, deleteE2eSessions, e2eSessionName, openApp } from "./helpers";

/**
 * Session-wide search. No LLM prompt: a `!` command writes an entry, and a step back through
 * the session tree takes that entry off the shown branch, which is exactly the case the
 * browser's own find cannot cover.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = "/srv/pi-tau/e2e/shots";
const SESSION_NAME = e2eSessionName("search");
const MARKER = "tau-hay-needle-42";

let page: Page;
let errors: string[];

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
	await composer(page).fill(`!echo ${MARKER}`);
	await composer(page).press("Enter");
	await expect(page.locator("main")).toContainText(MARKER, { timeout: 30_000 });
});

test.afterAll(async () => {
	await deleteE2eSessions(page);
	await page.close();
});

test("the model and thinking selectors sit in the composer, not in the header", async () => {
	const composerBar = page.getByTestId("composer-tools");
	await expect(composerBar.getByRole("button", { name: /GLM/ })).toBeVisible();
	await expect(composerBar.getByTitle("Thinking")).toBeVisible();
	// The header keeps the session name and the icon buttons only.
	await expect(page.locator("header").getByRole("button", { name: /GLM/ })).toHaveCount(0);
	await expect(page.locator("header").getByTitle("Thinking")).toHaveCount(0);
});

test("the icon grows into a field and finds an entry of this session", async () => {
	const box = page.getByTestId("header-search");
	const input = page.getByTestId("search-input");
	const collapsed = await box.boundingBox();
	await expect(input).toBeHidden();

	await page.getByTestId("search-toggle").click();
	await expect(input).toBeVisible();
	const expanded = await box.boundingBox();
	expect(expanded?.width ?? 0).toBeGreaterThan((collapsed?.width ?? 0) + 40);

	await input.fill(MARKER);
	const results = page.getByTestId("search-results");
	await expect(results).toBeVisible();
	await expect(results.getByTestId("search-result")).toHaveCount(1);
	await expect(results.getByTestId("search-result").first()).toContainText(MARKER);
	await page.screenshot({ path: `${SHOTS}/90-search-open.png`, animations: "disabled" });

	// Enter keeps the list open, so repeated presses walk through the hits.
	await input.press("Enter");
	await expect(results).toBeVisible();

	// Picking a hit that is on screen closes the field again.
	await results.getByTestId("search-result").first().click();
	await expect(input).toBeHidden();
});

test("Ctrl+F opens the field and puts the caret in it", async () => {
	await composer(page).click();
	await page.keyboard.press("Control+f");
	const input = page.getByTestId("search-input");
	await expect(input).toBeVisible();
	await expect(input).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(input).toBeHidden();
});

test("a hit on an abandoned branch is found and reached", async () => {
	// Step back to the first entry: the shell run is then no longer part of the transcript.
	await page.getByRole("button", { name: "Session tree" }).click();
	const dialog = page.getByTestId("tree-dialog");
	await expect(dialog).toBeVisible();
	await dialog.getByTestId("tree-row").first().click();
	await expect(dialog).toBeHidden();
	await expect(page.locator("main")).not.toContainText(MARKER, { timeout: 30_000 });

	// The browser's find would see nothing here; the host reads the session file.
	await page.keyboard.press("Control+f");
	await page.getByTestId("search-input").fill(MARKER);
	const results = page.getByTestId("search-results");
	await expect(results.getByTestId("search-result")).toHaveCount(1);
	const hit = results.getByTestId("search-result").first();
	await expect(hit).toHaveAttribute("title", /another branch/);
	await page.screenshot({ path: `${SHOTS}/91-search-off-branch.png`, animations: "disabled" });

	// Opening it moves the session to that branch, so the entry is back on screen.
	await hit.click();
	await expect(page.locator("main")).toContainText(MARKER, { timeout: 30_000 });
	await expect(page.getByTestId("search-input")).toBeHidden();
});

test("no console errors", () => {
	expect(errors).toEqual([]);
});

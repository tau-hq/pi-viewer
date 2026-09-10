import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { collectErrors, composer, openApp } from "./helpers";

/**
 * Round B features that need a session: the advanced options of session creation, the package
 * dialog and the resource switches. No LLM prompt is sent — the session is created with a tool
 * allow-list and is thrown away by pi (ephemeral), and every assertion reads host state.
 *
 * The resource tab works on the session's directory, so the session runs in /srv/pi: that
 * checkout ships extensions, skills and prompts, while /srv/pi-tau ships none.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = "/srv/pi-tau/e2e/shots";
const PROJECT = "/srv/pi";
const PROJECT_SETTINGS = `${PROJECT}/.pi/settings.json`;

let page: Page;
let errors: string[];
/** Content of the project settings file before the run; undefined when it did not exist. */
let settingsBefore: string | undefined;

test.beforeAll(async ({ browser }) => {
	settingsBefore = existsSync(PROJECT_SETTINGS) ? readFileSync(PROJECT_SETTINGS, "utf8") : undefined;
	page = await browser.newPage();
	errors = collectErrors(page);
	await openApp(page);
});

test.afterAll(async () => {
	await page.close();
	// The resource switch writes into the project's settings file; leave the checkout as it was.
	if (settingsBefore === undefined) rmSync(PROJECT_SETTINGS, { force: true });
	else writeFileSync(PROJECT_SETTINGS, settingsBefore, "utf8");
});

test("advanced options start a session with a single tool and no session file", async () => {
	await page
		.getByRole("button", { name: /New session/ })
		.first()
		.click();
	const cwd = page.getByLabel("Working directory");
	await expect(cwd).toBeVisible();
	await cwd.fill(PROJECT);

	// Collapsed by default: the simple path stays a directory plus a model.
	await expect(page.getByTestId("session-advanced")).toHaveCount(0);
	await page.getByTestId("session-advanced-toggle").click();
	const advanced = page.getByTestId("session-advanced");
	await expect(advanced).toBeVisible();

	// An allow-list with nothing ticked means no tools at all, and says so.
	await page.getByTestId("session-restrict-tools").click();
	await expect(page.getByTestId("session-no-tools")).toBeVisible();
	await advanced.locator("#session-tools-read").check();
	await expect(page.getByTestId("session-no-tools")).toHaveCount(0);
	await page.getByTestId("session-ephemeral").click();
	await page.getByTestId("session-no-context-files").click();
	// systemPrompt, tools, noContextFiles and ephemeral: four options on the collapsed summary.
	await advanced.locator("#session-system-prompt").fill("Answer with one word.");
	await expect(page.getByTestId("session-advanced-toggle")).toContainText("4");
	await page.screenshot({ path: `${SHOTS}/94-session-advanced.png`, animations: "disabled" });

	await page.getByRole("button", { name: "Create", exact: true }).click();
	await expect(composer(page)).toBeVisible({ timeout: 30_000 });
	await expect(page.locator("header")).toContainText(PROJECT);

	// pi got --tools read, so its tool set has exactly that one entry.
	await page.getByRole("button", { name: "Tools", exact: true }).click();
	const tools = page.getByTestId("tools-dialog");
	await expect(tools).toBeVisible();
	await expect(tools.locator("#tool-read")).toBeVisible({ timeout: 30_000 });
	await expect(tools).toContainText("1 of 1 active");
	await expect(tools.locator("#tool-bash")).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(tools).toBeHidden();
});

test("the package dialog lists nothing yet and refuses a bad source", async () => {
	await page.getByRole("button", { name: "Packages", exact: true }).click();
	const dialog = page.getByTestId("packages-dialog");
	await expect(dialog).toBeVisible();
	await expect(page.getByTestId("packages-empty")).toContainText("No packages installed");
	await expect(dialog).toContainText("0 installed");
	// Nothing to update, and the project note names the session's directory.
	await expect(page.getByTestId("packages-update-all")).toBeDisabled();
	await expect(dialog).toContainText(`Project entries belong to ${PROJECT}`);
	await page.screenshot({ path: `${SHOTS}/90-packages-empty.png`, animations: "disabled" });

	// A source pi could not parse is refused in the client, before any npm run.
	await page.getByTestId("packages-source").fill("not a package");
	await page.getByTestId("packages-install").click();
	await expect(page.getByTestId("packages-error")).toContainText("Enter npm:package");

	// A well formed source that does not exist comes back as the host's own message.
	await page.getByTestId("packages-source").fill("/srv/tau-does-not-exist-pkg");
	await page.getByTestId("packages-install").click();
	await expect(page.getByTestId("packages-error")).toContainText("Path does not exist");
	await expect(page.getByTestId("packages-source")).toHaveValue("/srv/tau-does-not-exist-pkg");
	await expect(page.getByTestId("packages-empty")).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/91-packages-invalid.png`, animations: "disabled" });
});

test("the resource tab lists the project's resources and switches one off and on", async () => {
	await page.getByTestId("packages-view-resources").click();
	const dialog = page.getByTestId("packages-dialog");
	await expect(page.getByTestId("resources-group-skills")).toBeVisible();
	// /srv/pi ships four extensions, three skills, six prompts and no theme.
	await expect(page.getByTestId("resources-group-extensions").getByTestId("resource-row")).toHaveCount(4);
	await expect(page.getByTestId("resources-group-skills").getByTestId("resource-row")).toHaveCount(3);
	await expect(page.getByTestId("resources-group-prompts").getByTestId("resource-row")).toHaveCount(6);
	await expect(page.getByTestId("resources-group-skills")).toContainText("3 of 3 on");
	await expect(page.getByTestId("resources-group-themes")).toContainText("None");
	// Discovered, not shipped by a package, and project scoped.
	const row = page.locator("[data-testid=resource-row][data-name=release]");
	await expect(row).toContainText("discovered");
	await expect(row).toContainText("This project");
	// The trust control travels with the tab, because pi ignores an untrusted project's resources.
	await expect(dialog.getByTestId("trust-section")).toBeVisible();
	await expect(dialog).toContainText("only from trusted projects");
	await page.screenshot({ path: `${SHOTS}/92-resources.png`, animations: "disabled" });

	// Write the decision into the project, so the machine's global settings stay untouched.
	await page.getByTestId("resources-scope-project").click();
	await page.locator("#resource-skills-release").click();
	await expect(row).toHaveAttribute("data-enabled", "false");
	await expect(page.getByTestId("resources-group-skills")).toContainText("2 of 3 on");
	expect(readFileSync(PROJECT_SETTINGS, "utf8")).toContain("-/srv/pi/.pi/skills/release.md");
	await page.screenshot({ path: `${SHOTS}/93-resources-toggled.png`, animations: "disabled" });

	// Back on: pi's exclude entry disappears again.
	await page.locator("#resource-skills-release").click();
	await expect(row).toHaveAttribute("data-enabled", "true");
	await expect(page.getByTestId("resources-group-skills")).toContainText("3 of 3 on");
	expect(readFileSync(PROJECT_SETTINGS, "utf8")).not.toContain("release.md");
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	expect(errors).toEqual([]);
});

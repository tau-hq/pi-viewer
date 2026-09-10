import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { collectErrors, composer, openApp } from "./helpers";

// A project that ships a skill of its own: pi asks before it loads project resources.
// The host runs on this machine, so the test can create that project itself.
const PROJECT = "/tmp/tau-trust-e2e";

test.describe.configure({ mode: "serial" });

let page: Page;
let errors: string[];

test.beforeAll(async ({ browser }) => {
	mkdirSync(`${PROJECT}/.pi/skills`, { recursive: true });
	writeFileSync(
		`${PROJECT}/.pi/skills/tau-e2e.md`,
		"---\nname: tau-e2e\ndescription: Skill used by Tau's trust test.\n---\nSay hello.\n",
	);
	page = await browser.newPage();
	errors = collectErrors(page);
	await openApp(page);
});

test.afterAll(async () => {
	await page.close();
	rmSync(PROJECT, { recursive: true, force: true });
});

test("a project with its own skills asks for a trust decision above the composer", async () => {
	await page
		.getByRole("button", { name: /New session/ })
		.first()
		.click();
	await page.getByLabel("Working directory").fill(PROJECT);
	await page.getByRole("button", { name: "Create", exact: true }).click();
	await expect(composer(page)).toBeVisible({ timeout: 30_000 });

	const banner = page.getByTestId("trust-banner");
	await expect(banner).toBeVisible({ timeout: 20_000 });
	await expect(banner).toContainText("This project ships extensions/skills");
	await expect(banner).toContainText("Applies to sessions started after the decision");
	await expect(banner.getByTestId("trust-accept")).toBeVisible();

	await banner.getByTestId("trust-reject").click();
	await expect(banner).toBeHidden();
	await expect(page.locator("output").last()).toContainText("Project resources stay disabled");
});

test("the configuration dialog shows the decision and takes it back", async () => {
	await page.getByRole("button", { name: "Configuration", exact: true }).click();
	const section = page.getByTestId("trust-section");
	await expect(section).toBeVisible();
	await expect(section).toContainText(PROJECT);
	await expect(section.getByTestId("trust-decision")).toHaveText("Not trusted");

	await section.getByTestId("trust-section-trust").click();
	await expect(section.getByTestId("trust-decision")).toHaveText("Trusted");

	// "Ask again" clears the decision, so the banner comes back for this project.
	await section.getByTestId("trust-section-reset").click();
	await expect(section.getByTestId("trust-decision")).toHaveText("Undecided");
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("config-dialog")).toBeHidden();
	await expect(page.getByTestId("trust-banner")).toBeVisible();
});

test("the header menu reloads extensions and skills", async () => {
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByTestId("menu-reload-resources").click();
	await expect(page.locator("output").last()).toContainText("Extensions, skills and prompts reloaded");
	expect(errors).toEqual([]);
});

test("deletes the temporary session again", async () => {
	// The project directory is removed after this file, so its session must not stay listed.
	const group = page.locator(`[data-project-cwd="${PROJECT}"]`);
	await expect(group).toBeVisible();
	await group.getByTestId("session-item").first().hover();
	await group.getByRole("button", { name: "Session actions" }).first().click();
	await page.getByRole("menuitem", { name: "Delete" }).click();
	await page.getByRole("button", { name: "Delete", exact: true }).click();
	await expect(group).toHaveCount(0);
	expect(errors).toEqual([]);
});

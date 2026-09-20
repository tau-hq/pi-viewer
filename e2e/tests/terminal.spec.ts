import { expect, type Page, test } from "@playwright/test";
import {
	closeHostTerminals,
	collectErrors,
	composer,
	deleteE2eSessions,
	e2eSessionName,
	openApp,
	terminalRows,
	terminalType,
	trustProject,
} from "./helpers";

// One page for the whole file; the terminals are real PTYs on the host but need no LLM.
test.describe.configure({ mode: "serial" });

let page: Page;
let errors: string[];

// The terminals need a session so the dock knows a working directory; the spec creates its
// own instead of borrowing one, so it does not depend on what the machine happens to hold.
const PROJECT = "/srv/pi-tau";
const SESSION_NAME = e2eSessionName("terminal");

test.beforeAll(async ({ browser }) => {
	page = await browser.newPage();
	errors = collectErrors(page);
	await openApp(page);
	await closeHostTerminals(page);
	// pi's terminal UI stops at a trust question in a project that ships .pi resources.
	await trustProject(page, PROJECT);
	await page
		.getByRole("button", { name: /New session/ })
		.first()
		.click();
	await page.getByLabel("Working directory").fill(PROJECT);
	await page.getByRole("button", { name: "Create", exact: true }).click();
	await expect(composer(page)).toBeVisible({ timeout: 30_000 });
	await composer(page).fill(`/name ${SESSION_NAME}`);
	await composer(page).press("Enter");
	await expect(page.locator("header").getByText(SESSION_NAME)).toBeVisible();
});

test.afterAll(async () => {
	await closeHostTerminals(page).catch(() => undefined);
	await deleteE2eSessions(page).catch(() => undefined);
	await page.close();
});

const tabs = () => page.getByTestId("terminal-tab");

async function closeActiveTab(): Promise<void> {
	const count = await tabs().count();
	await tabs().first().hover();
	await page.getByRole("button", { name: "Close terminal" }).first().click();
	await expect(tabs()).toHaveCount(count - 1);
}

test("the header button opens a shell terminal that runs commands", async () => {
	await page.getByTestId("header-terminal").click();
	await expect(page.getByTestId("terminal-panel")).toBeVisible();
	await expect(tabs()).toHaveCount(1);
	await expect(tabs().first()).toHaveAttribute("data-kind", "shell");
	await expect(terminalRows(page)).toBeVisible({ timeout: 20_000 });

	await terminalType(page, "echo tau-xterm");
	// The command line is echoed and the output follows, so the marker shows up twice.
	await expect(terminalRows(page)).toContainText("tau-xterm");
	await closeActiveTab();
});

test("a terminal survives switching to another session and back", async () => {
	// The tests before this one leave the panel in whatever state they ended in.
	if (!(await page.getByTestId("terminal-panel").isVisible())) await page.getByTestId("header-terminal").click();
	await expect(page.getByTestId("terminal-panel")).toBeVisible();
	if ((await tabs().count()) === 0) {
		await page.getByRole("button", { name: "New terminal" }).click();
		await page.getByTestId("terminal-new-shell").click();
	}
	await expect(terminalRows(page)).toBeVisible({ timeout: 20_000 });
	await terminalType(page, "echo tau-keeps-running");
	await expect(terminalRows(page)).toContainText("tau-keeps-running");

	// Show another session and come back; the panel and its output must still stand.
	const other = page.getByTestId("session-item").filter({ hasNotText: SESSION_NAME }).first();
	const hasOther = (await other.count()) > 0;
	test.skip(!hasOther, "needs a second session in the sidebar");
	await other.click();
	await expect(page.getByTestId("terminal-panel")).toBeVisible();
	await page.getByTestId("session-item").filter({ hasText: SESSION_NAME }).first().click();
	await expect(terminalRows(page)).toContainText("tau-keeps-running");
	await closeActiveTab();
});

test("pi's own terminal UI runs in a tab and /quit ends it", async () => {
	await page.getByRole("button", { name: "New terminal" }).click();
	await page.getByTestId("terminal-new-pi").click();
	await expect(tabs()).toHaveCount(1);
	await expect(tabs().first()).toHaveAttribute("data-kind", "pi");
	// pi's startup screen. Not the keyboard hint: an upstream update banner can displace it.
	// The status line with the working directory is always there.
	await expect(terminalRows(page)).toContainText(PROJECT, { timeout: 60_000 });

	// Typing reaches the TUI: a slash command renders its own screen.
	await terminalType(page, "/hotkeys");
	await expect(terminalRows(page)).toContainText(/Run bash command/, { timeout: 30_000 });

	await terminalType(page, "/quit");
	await expect(page.getByTestId("terminal-exited")).toBeVisible({ timeout: 30_000 });
	await expect(page.getByTestId("terminal-exited")).toContainText("process exited (code 0)");
	await expect(page.getByTestId("terminal-exited-dot")).toBeVisible();
	await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
	await closeActiveTab();
});

test("the panel and its terminal survive a page reload", async () => {
	await page.getByRole("button", { name: "New terminal" }).click();
	await page.getByTestId("terminal-new-shell").click();
	await expect(terminalRows(page)).toBeVisible({ timeout: 20_000 });
	await terminalType(page, "echo tau-reattach");
	await expect(terminalRows(page)).toContainText("tau-reattach");

	await page.reload({ waitUntil: "networkidle" });
	// No session is selected after a reload, but terminals belong to the host and are adopted.
	await expect(page.getByTestId("terminal-panel")).toBeVisible({ timeout: 20_000 });
	await expect(tabs()).toHaveCount(1);
	// The host replays the scrollback on attach.
	await expect(terminalRows(page)).toContainText("tau-reattach", { timeout: 20_000 });
	expect(errors).toEqual([]);
});

test("Ctrl+` toggles the panel and the drag handle resizes it", async () => {
	await page.keyboard.press("Control+`");
	await expect(page.getByTestId("terminal-dock")).toBeHidden();
	await page.keyboard.press("Control+`");
	await expect(page.getByTestId("terminal-dock")).toBeVisible();

	const handle = await page.getByTestId("terminal-resize").boundingBox();
	const before = await page.getByTestId("terminal-dock").boundingBox();
	if (!handle || !before) throw new Error("terminal panel is not on screen");
	await page.mouse.move(handle.x + 200, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + 200, handle.y + handle.height / 2 - 100, { steps: 8 });
	await page.mouse.up();
	await expect
		.poll(async () => Math.round((await page.getByTestId("terminal-dock").boundingBox())?.height ?? 0))
		.toBeGreaterThan(Math.round(before.height) + 50);
	expect(errors).toEqual([]);
});

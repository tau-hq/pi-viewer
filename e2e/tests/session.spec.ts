import { expect, type Page, test } from "@playwright/test";
import { collectErrors, composer, openApp, sendPrompt, untilIdle } from "./helpers";

// One session and one page for the whole file: three LLM prompts in total.
test.describe.configure({ mode: "serial" });

let page: Page;
let errors: string[];
const SESSION_NAME = `tau e2e ${new Date().toISOString().slice(11, 19)}`;

test.beforeAll(async ({ browser }) => {
	page = await browser.newPage();
	errors = collectErrors(page);
	await openApp(page);
});

test.afterAll(async () => {
	await page.close();
});

test("creates a session through the dialog with the directory picker", async () => {
	await page
		.getByRole("button", { name: /New session/ })
		.first()
		.click();
	const cwd = page.getByLabel("Working directory");
	await expect(cwd).toBeVisible();
	const picker = page.getByTestId("directory-picker");
	await expect(picker.getByRole("button", { name: "..", exact: true })).toBeVisible();
	const start = await cwd.inputValue();
	expect(start.length).toBeGreaterThan(0);
	// Descend into the first listed directory and come back with "..".
	const first = picker.getByRole("listitem").nth(1).getByRole("button");
	const name = (await first.textContent())?.trim() ?? "";
	await first.click();
	await expect(cwd).toHaveValue(new RegExp(`${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}$`));
	await picker.getByRole("button", { name: "..", exact: true }).click();
	await expect(cwd).toHaveValue(start);
	await page.getByRole("button", { name: "Create", exact: true }).click();
	await expect(composer(page)).toBeVisible({ timeout: 30_000 });
	// Name it via the slash command so the session is easy to find later.
	await composer(page).fill(`/name ${SESSION_NAME}`);
	await composer(page).press("Enter");
	await expect(page.locator("header").getByText(SESSION_NAME)).toBeVisible();
});

test("prompt round trip shows an assistant message and returns the composer", async () => {
	await sendPrompt(page, "Reply with exactly the word pong and nothing else.");
	await untilIdle(page);
	await expect(page.locator("main .md").last()).toContainText(/pong/i);
	await expect(composer(page)).toHaveAttribute("placeholder", /^Message pi/);
});

test("tool approval: Allow once runs the tool", async () => {
	await sendPrompt(
		page,
		"You must use the bash tool. Run exactly: echo tau-allow — then reply with its output and nothing else.",
	);
	const dialog = page.getByTestId("ui-request");
	await expect(dialog).toBeVisible({ timeout: 120_000 });
	await expect(dialog.getByText("Tool approval")).toBeVisible();
	await expect(dialog.getByRole("heading")).toHaveText("bash");
	await expect(dialog.locator("pre")).toContainText("echo tau-allow");
	await dialog.getByRole("button", { name: "Allow once" }).click();
	await expect(dialog).toBeHidden();
	await untilIdle(page, (again) => again.getByRole("button", { name: "Allow once" }).click());
	await expect(page.locator("main")).toContainText("tau-allow");
});

test("tool approval: Deny blocks the tool", async () => {
	await sendPrompt(
		page,
		"You must use the bash tool. Run exactly: echo tau-deny — if the call is not allowed, reply with one short sentence saying so.",
	);
	const dialog = page.getByTestId("ui-request");
	await expect(dialog).toBeVisible({ timeout: 120_000 });
	await page.keyboard.press("d");
	await expect(dialog).toBeHidden();
	await untilIdle(page, (again) => again.getByRole("button", { name: "Deny" }).click());
	await expect(page.locator("main")).toContainText("Denied");
	expect(errors).toEqual([]);
});

test("downloads the session as JSONL from the header menu", async () => {
	await page.getByRole("button", { name: "More actions" }).click();
	const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("menu-export-jsonl").click()]);
	expect(download.suggestedFilename()).toMatch(/\.jsonl$/);
	const stream = await download.createReadStream();
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	const first = Buffer.concat(chunks).toString("utf8").split("\n")[0] ?? "";
	expect(JSON.parse(first)).toMatchObject({ type: "session" });
});

test("skills and prompts dialog puts a command into the composer", async () => {
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByTestId("menu-commands").click();
	const dialog = page.getByTestId("commands-dialog");
	await expect(dialog).toBeVisible();
	const items = dialog.getByTestId("command-item");
	// The host loads Tau's pi extension, so at least its commands are listed.
	await expect(items.first()).toBeVisible();
	await expect(dialog.locator("h3").first()).toHaveText("Extensions");
	const name = (await items.first().locator("span").first().textContent())?.trim() ?? "";
	expect(name.startsWith("/")).toBe(true);
	await items.first().click();
	await expect(dialog).toBeHidden();
	await expect(composer(page)).toHaveValue(`${name} `);
	await composer(page).fill("");
	expect(errors).toEqual([]);
});

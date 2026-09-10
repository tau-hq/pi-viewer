import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { collectErrors, openApp, toasts } from "./helpers";

// Provider logins and pi's configuration files need no session and no LLM round trip.
test.describe.configure({ mode: "serial" });

const SHOTS = "/srv/pi-tau/e2e/shots";
/** pi's real settings file on this host; every write below is taken back again. */
const GLOBAL_SETTINGS = "/root/.pi/agent/settings.json";

let page: Page;
let errors: string[];

test.beforeAll(async ({ browser }) => {
	page = await browser.newPage();
	errors = collectErrors(page);
	await openApp(page);
});

test.afterAll(async () => {
	await page.close();
});

async function openProviders(): Promise<void> {
	await page.getByRole("button", { name: "Providers", exact: true }).click();
	await expect(page.getByTestId("providers-dialog")).toBeVisible();
	await expect(page.getByTestId("providers-dialog").locator("[data-provider]").first()).toBeVisible();
}

test("providers dialog lists nebius as configured", async () => {
	await openProviders();
	const dialog = page.getByTestId("providers-dialog");
	const nebius = dialog.locator('[data-provider="nebius"]');
	await expect(nebius).toBeVisible();
	await expect(nebius).toContainText("Configured");
	await expect(nebius).toContainText("API key");
	// Configured providers come first and offer a way out.
	await expect(dialog.locator("[data-provider]").first()).toHaveAttribute("data-provider", "nebius");
	await expect(nebius.getByRole("button", { name: "Log out" })).toBeVisible();
	// A provider with both methods shows both buttons plus the subscription hint.
	const vendor = dialog.locator('[data-provider="vendor"]');
	await expect(vendor.getByRole("button", { name: "API key" })).toBeVisible();
	await expect(vendor.getByRole("button", { name: /Sign in/ })).toContainText("subscription");
});

test("vendor api key login shows a secret prompt and cancels cleanly", async () => {
	const vendor = page.getByTestId("providers-dialog").locator('[data-provider="vendor"]');
	await vendor.getByRole("button", { name: "API key" }).click();
	const login = page.getByTestId("login-dialog");
	await expect(login).toBeVisible();
	await expect(login).toContainText("Sign in to Vendor");
	const secret = page.getByTestId("auth-secret");
	await expect(secret).toBeVisible({ timeout: 30_000 });
	// A secret is never echoed and never leaves the input before it is sent.
	await expect(secret).toHaveAttribute("type", "password");
	await expect(secret).toHaveValue("");
	await expect(login.locator("label")).toContainText(/API key/i);
	await login.getByRole("button", { name: "Cancel" }).click();
	await expect(login).toBeHidden();
	// Cancelling is not an error and leaves the provider list open.
	await expect(page.getByTestId("login-error")).toHaveCount(0);
	await expect(page.getByTestId("providers-dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("providers-dialog")).toBeHidden();
});

test("the typed settings form shows effective values and writes one key", async () => {
	const original = readFileSync(GLOBAL_SETTINGS, "utf8");
	await page.getByRole("button", { name: "Configuration", exact: true }).click();
	const dialog = page.getByTestId("config-dialog");
	await expect(dialog).toBeVisible();
	// The form is the front door; the raw JSON editor sits behind "Advanced".
	await expect(page.getByTestId("settings-form")).toBeVisible();
	await expect(page.getByTestId("config-path")).toHaveText(GLOBAL_SETTINGS);
	for (const group of ["behaviour", "models", "connection", "display", "tools", "sessions"]) {
		await expect(page.getByTestId(`settings-group-${group}`)).toBeVisible();
	}

	// Values come from the file this host really uses.
	await expect(dialog.locator("#setting-compaction-enabled")).toHaveAttribute("aria-checked", "true");
	await expect(dialog.locator("#setting-retry-enabled")).toHaveAttribute("aria-checked", "true");
	await expect(dialog.locator("#setting-steeringMode")).toHaveValue("one-at-a-time");
	await expect(dialog.locator("#setting-followUpMode")).toHaveValue("one-at-a-time");
	// Keys pi only reads from its own file, and keys nobody has set yet.
	await expect(dialog.locator("#setting-showCacheMissNotices")).toHaveAttribute("aria-checked", "false");
	await expect(page.getByTestId("setting-showCacheMissNotices-clear")).toHaveCount(0);
	await expect(page.getByTestId("setting-compaction-enabled-clear")).toBeVisible();
	await expect(page.getByTestId("setting-httpProxy-row")).toContainText("not set");
	await page.screenshot({ path: `${SHOTS}/95-settings-form.png`, animations: "disabled" });

	// In project scope the same value is marked as coming from the global file.
	await page.getByTestId("config-scope-project").click();
	await expect(page.getByTestId("setting-compaction-enabled-row")).toContainText("from Global");
	await expect(dialog.locator("#setting-defaultProjectTrust")).toBeDisabled();
	await expect(page.getByTestId("setting-defaultProjectTrust-row")).toContainText("only from the global file");
	await page.getByTestId("config-scope-global").click();
	await expect(page.getByTestId("setting-compaction-enabled-row")).not.toContainText("from Global");

	// One harmless key: switch it on, save, and check the file the host wrote.
	await expect(page.getByTestId("settings-form-save")).toBeDisabled();
	await dialog.locator("#setting-showCacheMissNotices").click();
	await expect(dialog).toContainText("1 changed");
	await page.screenshot({ path: `${SHOTS}/96-settings-form-dirty.png`, animations: "disabled" });
	await page.getByTestId("settings-form-save").click();
	await expect(toasts(page)).toContainText(`Saved to ${GLOBAL_SETTINGS}`);
	await expect(page.getByTestId("settings-form-save")).toBeDisabled();
	expect(JSON.parse(readFileSync(GLOBAL_SETTINGS, "utf8")) as Record<string, unknown>).toMatchObject({
		showCacheMissNotices: true,
	});

	// Take it back: the eraser writes null, which the host uses to delete the key again.
	await page.getByTestId("setting-showCacheMissNotices-clear").click();
	await expect(dialog).toContainText("1 changed");
	await page.getByTestId("settings-form-save").click();
	await expect(page.getByTestId("settings-form-save")).toBeDisabled();
	await expect(dialog.locator("#setting-showCacheMissNotices")).toHaveAttribute("aria-checked", "false");
	expect(readFileSync(GLOBAL_SETTINGS, "utf8")).toBe(original);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});

test("config editor reads the global models file and warns about credentials", async () => {
	await page.getByRole("button", { name: "Configuration", exact: true }).click();
	const dialog = page.getByTestId("config-dialog");
	await expect(dialog).toBeVisible();
	await dialog.getByTestId("config-view-raw").click();
	const editor = page.getByTestId("config-editor");
	await expect(page.getByTestId("config-path")).toHaveText(/settings\.json$/);
	await expect(page.getByTestId("config-credentials-warning")).toHaveCount(0);

	await dialog.getByRole("tab", { name: "Models" }).click();
	await expect(page.getByTestId("config-path")).toHaveText(/models\.json$/);
	await expect(page.getByTestId("config-credentials-warning")).toBeVisible();
	await expect(editor).not.toHaveValue("");
	// The file is shown as it is, so the configured provider is visible in the raw JSON.
	expect(await editor.inputValue()).toContain("nebius");

	// Broken JSON is refused in the client; nothing is written.
	await dialog.getByRole("tab", { name: "Settings" }).click();
	await expect(page.getByTestId("config-path")).toHaveText(/settings\.json$/);
	const original = await editor.inputValue();
	await editor.fill("{ broken");
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(page.getByTestId("config-error")).toContainText("Not valid JSON");
	await dialog.getByRole("button", { name: "Reload" }).click();
	await expect(editor).toHaveValue(original);
	await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	expect(errors).toEqual([]);
});

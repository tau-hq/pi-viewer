import { expect, test } from "@playwright/test";
import { composer, openApp } from "./helpers";

test.use({ viewport: { width: 430, height: 900 } });

test("narrow layout uses a sidebar drawer", async ({ page }) => {
	await openApp(page);
	await expect(page.locator("aside")).toHaveCount(0);
	const open = page.getByRole("button", { name: "Open sessions" });
	await expect(open).toBeVisible();
	await open.click();
	const drawer = page.getByTestId("drawer");
	await expect(drawer).toBeVisible();
	await page.getByTestId("drawer-backdrop").click({ position: { x: 400, y: 450 } });
	await expect(drawer).toBeHidden();
	await open.click();
	await expect(drawer).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(drawer).toBeHidden();
	await open.click();
	await expect(drawer).toBeVisible();
	await drawer.getByTestId("session-item").first().click();
	await expect(drawer).toBeHidden();
	await expect(composer(page)).toBeVisible({ timeout: 30_000 });
	await expect(page.locator("main")).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { collectErrors, openApp } from "./helpers";

test("loads without console errors", async ({ page }) => {
	const errors = collectErrors(page);
	await openApp(page);
	await expect(page.getByText("Tau", { exact: true }).first()).toBeVisible();
	await page.waitForTimeout(1000);
	expect(errors).toEqual([]);
});

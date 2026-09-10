import { chromium } from "playwright";

const OUT = "/srv/pi-tau/e2e/shots";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const issues = [];
page.on("console", (m) => {
	if (m.type() === "error") issues.push(`console: ${m.text().slice(0, 200)}`);
});
page.on("pageerror", (e) => issues.push(`pageerror: ${e.message.slice(0, 200)}`));
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const step = async (name, fn) => {
	try {
		await fn();
		console.log("ok  ", name);
	} catch (e) {
		console.log("FAIL", name, "-", e.message.split("\n")[0].slice(0, 160));
		await shot(`fail-${name}`);
	}
};

await page.goto("http://127.0.0.1:8787/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await shot("01-start");

await step("new-session", async () => {
	await page
		.getByRole("button", { name: /New session/ })
		.first()
		.click();
	const cwd = page.getByLabel("Working directory");
	await cwd.waitFor({ timeout: 5000 });
	console.log("     cwd prefilled:", await cwd.inputValue());
	await page.getByRole("button", { name: "Create" }).click();
	await page.getByPlaceholder(/Message pi/).waitFor({ timeout: 30000 });
	await page.waitForTimeout(500);
	await shot("02-empty-session");
});

await step("prompt-markdown", async () => {
	const box = page.getByPlaceholder(/Message pi/);
	await box.fill(
		"Antworte auf Deutsch: Was bedeutet der griechische Buchstabe Tau? Nutze eine Ueberschrift, eine Aufzaehlung mit drei Punkten und einen kurzen Codeblock mit dem Zeichen.",
	);
	await box.press("Enter");
	await page.waitForTimeout(2500);
	await shot("03-streaming");
	await page.getByPlaceholder(/Message pi/).waitFor({ timeout: 180000 });
	await page.waitForTimeout(600);
	await shot("04-answer");
	const text = await page.locator("main, body").first().textContent();
	console.log("     answer mentions Tau:", /Tau|τ/.test(text));
});

await step("tool-approval", async () => {
	const box = page.getByPlaceholder(/Message pi/);
	await box.fill("Fuehre mit dem bash-Werkzeug genau `ls -1 packages` aus und nenne mir die Namen als Liste.");
	await box.press("Enter");
	const allow = page.getByRole("button", { name: "Allow once" }).or(page.getByText("Allow once"));
	await allow.first().waitFor({ timeout: 120000 });
	await page.waitForTimeout(400);
	await shot("05-approval-dialog");
	await allow.first().click();
	await page.getByPlaceholder(/Message pi/).waitFor({ timeout: 180000 });
	await page.waitForTimeout(800);
	await shot("06-tool-result");
	const text = await page.locator("body").textContent();
	console.log("     tool output visible (client/host):", /client/.test(text) && /host/.test(text));
});

await step("model-picker", async () => {
	await page
		.getByRole("button", { name: /GLM|Model|No model/ })
		.first()
		.click();
	await page.waitForTimeout(500);
	await shot("07-model-picker");
	await page.keyboard.press("Escape");
});

await step("stats", async () => {
	await page
		.getByRole("button", { name: /Statistics/ })
		.first()
		.click();
	await page.waitForTimeout(500);
	await shot("08-stats");
	await page.keyboard.press("Escape");
});

await step("light-mode", async () => {
	await page.getByRole("button", { name: /Switch to light mode/ }).click();
	await page.waitForTimeout(500);
	await shot("09-light");
	await page.getByRole("button", { name: /Switch to dark mode/ }).click();
});

await step("mobile", async () => {
	await page.setViewportSize({ width: 430, height: 900 });
	await page.waitForTimeout(600);
	await shot("10-mobile");
	await page.setViewportSize({ width: 1400, height: 900 });
});

console.log("console issues:", issues.length ? issues : "none");
await browser.close();

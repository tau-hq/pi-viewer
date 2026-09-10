import { chromium } from "playwright";

const S = process.env.S;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const errors = [];
page.on("console", (m) => {
	if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text().slice(0, 200)}`);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
await page.goto("http://127.0.0.1:8787/", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${S}/shots/01-start.png` });
console.log("title:", await page.title());
const items = await page.evaluate(() => {
	const out = [];
	for (const el of document.querySelectorAll(
		"button, a, input, textarea, [role=button], [role=menuitem], [contenteditable=true]",
	)) {
		const label = (
			el.getAttribute("aria-label") ||
			el.getAttribute("placeholder") ||
			el.getAttribute("title") ||
			el.textContent ||
			""
		)
			.trim()
			.replace(/\s+/g, " ")
			.slice(0, 50);
		out.push(
			`${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""}: ${label}`,
		);
	}
	return out;
});
console.log(`interactive elements:\n  ${items.join("\n  ")}`);
console.log("body text (head):", (await page.textContent("body")).replace(/\s+/g, " ").slice(0, 400));
console.log("console issues:", errors.length ? errors : "none");
await browser.close();

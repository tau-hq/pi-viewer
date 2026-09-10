import { chromium } from "playwright";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
const rows = () => page.locator("[data-testid=terminal-surface] .xterm-rows");
const text = async () => (await rows().innerText()).replace(/\u00a0/g, " ");
await page.goto("http://127.0.0.1:8787/", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.getByTestId("session-item").filter({ hasText: /tau e2e \d\d:\d\d/ }).first().click();
await page.locator("textarea").first().waitFor({ timeout: 30000 });
await page.getByTestId("header-terminal").click();
await rows().waitFor({ timeout: 20000 });
await page.waitForTimeout(1500);
await page.getByTestId("terminal-surface").click();
await page.keyboard.type("echo before-drop");
await page.keyboard.press("Enter");
await page.waitForTimeout(1000);
console.log("before drop:", (await text()).includes("before-drop"));

// Drop the connection and bring it back.
await context.setOffline(true);
await page.waitForTimeout(2500);
console.log("banner while offline:", (await page.locator("main").innerText()).split("\n")[0]);
await context.setOffline(false);
await page.waitForTimeout(5000);
const after = await text();
console.log("scrollback after reconnect has before-drop:", after.includes("before-drop"));
console.log("duplicates:", after.split("before-drop").length - 1);
await page.getByTestId("terminal-surface").click();
await page.keyboard.type("echo after-reconnect");
await page.keyboard.press("Enter");
await page.waitForTimeout(1500);
console.log("input works after reconnect:", (await text()).includes("after-reconnect"));
await page.screenshot({ path: "/srv/pi-tau/e2e/shots/62-terminal-reconnect.png" });

// Exit the shell and restart the tab.
await page.keyboard.type("exit");
await page.keyboard.press("Enter");
await page.waitForTimeout(2000);
console.log("exit bar:", await page.getByTestId("terminal-exited").textContent().catch(() => "missing"));
await page.getByRole("button", { name: "Restart" }).click();
await page.waitForTimeout(2500);
console.log("exit bar after restart:", await page.getByTestId("terminal-exited").count());
await page.getByTestId("terminal-surface").click();
await page.keyboard.type("echo restarted");
await page.keyboard.press("Enter");
await page.waitForTimeout(1200);
console.log("restarted terminal works:", (await text()).includes("restarted"));
await page.screenshot({ path: "/srv/pi-tau/e2e/shots/63-terminal-restarted.png" });
for (let i = await page.getByTestId("terminal-tab").count(); i > 0; i--) {
	await page.getByTestId("terminal-tab").first().hover();
	await page.getByRole("button", { name: "Close terminal" }).first().click();
	await page.waitForTimeout(300);
}
console.log("errors:", errors.length ? errors : "none");
await browser.close();

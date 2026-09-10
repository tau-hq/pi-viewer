import type { SessionSummary } from "@pi-tau/shared";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { collectErrors, composer, openApp } from "./helpers";

/**
 * The five-state circle left of a session name.
 *
 * No LLM prompt anywhere: the first test drives the real host (a fresh session is up to date, an
 * aged seen mark lights it up, opening it settles it again), the second answers the host socket
 * itself so all five states can stand next to each other — "last run failed" and "waiting for an
 * answer" otherwise need a model that calls a tool.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = "/srv/pi-tau/e2e/shots";
const SESSION_NAME = `tau status e2e ${new Date().toISOString().slice(11, 19)}`;

let page: Page;
let errors: string[];

/** The circle of the row for `name`. */
function statusOf(target: Page, name: string) {
	return target.getByTestId("session-item").filter({ hasText: name }).first().getByTestId("session-status");
}

test.beforeAll(async ({ browser }) => {
	page = await browser.newPage();
	errors = collectErrors(page);
	await openApp(page);
});

test.afterAll(async () => {
	await page.close();
});

test("a fresh session is up to date, an aged seen mark lights it up, opening it settles it", async () => {
	await page
		.getByRole("button", { name: /New session/ })
		.first()
		.click();
	await expect(page.getByLabel("Working directory")).toBeVisible();
	await page.getByRole("button", { name: "Create", exact: true }).click();
	await expect(composer(page)).toBeVisible({ timeout: 30_000 });
	// Named through the slash command, so the row is easy to find and no model is involved.
	await composer(page).fill(`/name ${SESSION_NAME}`);
	await composer(page).press("Enter");
	await expect(page.locator("header").getByText(SESSION_NAME)).toBeVisible();

	// The session is on screen with nothing running, so its circle is the quiet ring.
	await expect(statusOf(page, SESSION_NAME)).toHaveAttribute("data-status", "seen");
	// Which means the client remembered the timestamp it was looked at.
	const marks = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("tau.seen") ?? "{}")).length);
	expect(marks).toBeGreaterThan(0);

	// Age every mark: as far as the client knows, every session changed since it was last seen.
	await page.evaluate(() => {
		const seen = JSON.parse(localStorage.getItem("tau.seen") ?? "{}") as Record<string, number>;
		for (const id of Object.keys(seen)) seen[id] = 1;
		localStorage.setItem("tau.seen", JSON.stringify(seen));
	});
	await page.reload({ waitUntil: "networkidle" });
	await expect(page.getByRole("button", { name: /New session/ }).first()).toBeVisible();
	await expect(statusOf(page, SESSION_NAME)).toHaveAttribute("data-status", "unseen");
	await page
		.locator("aside")
		.first()
		.screenshot({ path: `${SHOTS}/110-status-unseen.png`, animations: "disabled" });

	// Opening the session marks it seen again, without a reload.
	await page.getByTestId("session-item").filter({ hasText: SESSION_NAME }).first().click();
	await expect(composer(page)).toBeVisible({ timeout: 30_000 });
	await expect(statusOf(page, SESSION_NAME)).toHaveAttribute("data-status", "seen");
	await page
		.locator("aside")
		.first()
		.screenshot({ path: `${SHOTS}/111-status-seen.png`, animations: "disabled" });
	expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// All five states at once, against a stubbed host socket
// ---------------------------------------------------------------------------

const MOCK_CWD = "/srv/pi-tau";

function mockSummary(id: string, name: string, modified: number, extra: Partial<SessionSummary> = {}): SessionSummary {
	return {
		id,
		path: `/tmp/tau-mock/${id}.jsonl`,
		cwd: MOCK_CWD,
		name,
		created: 1000,
		modified,
		messageCount: 2,
		firstMessage: "mock session",
		running: true,
		isStreaming: false,
		...extra,
	};
}

/** One session per state, newest first, plus one this browser has never opened. */
const MOCK_SESSIONS: SessionSummary[] = [
	mockSummary("mock-error", "Last run failed", 6000, { failed: true }),
	mockSummary("mock-input", "Waiting for an answer", 5000, { needsInput: true }),
	mockSummary("mock-working", "Working", 4000, { isStreaming: true }),
	mockSummary("mock-unseen", "Changed since you looked", 3000),
	mockSummary("mock-seen", "Up to date", 2000),
	mockSummary("mock-unknown", "Never opened here", 1000),
];

const MOCK_SEEN: Record<string, number> = { "mock-unseen": 1, "mock-seen": 2000 };

const EXPECTED: Record<string, string> = {
	"mock-error": "error",
	"mock-input": "needsInput",
	"mock-working": "working",
	"mock-unseen": "unseen",
	"mock-seen": "seen",
	"mock-unknown": "seen",
};

/** Answer the client's handshake and its three list commands; nothing else is needed here. */
async function stubHost(target: Page): Promise<void> {
	await target.routeWebSocket("**/ws", (socket) => {
		socket.onMessage((raw) => {
			const envelope = JSON.parse(String(raw)) as { type: string; id?: string; t?: number; command?: { type: string } };
			if (envelope.type === "hello") {
				const host = {
					name: "tau-mock",
					version: "0.0.1",
					piVersion: "0.0.0",
					platform: "linux",
					homeCwd: MOCK_CWD,
					defaultCwd: MOCK_CWD,
				};
				// TAU_PROTOCOL_VERSION; the client refuses another version.
				socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, host }));
				return;
			}
			if (envelope.type === "ping") {
				socket.send(JSON.stringify({ type: "pong", t: envelope.t }));
				return;
			}
			if (envelope.type !== "cmd" || envelope.id === undefined) return;
			const command = envelope.command?.type;
			const data =
				command === "sessions.list"
					? { sessions: MOCK_SESSIONS }
					: command === "projects.list"
						? { projects: [{ cwd: MOCK_CWD, name: "pi-tau", sessionCount: 6, lastModified: 6000, exists: true }] }
						: { models: [] };
			socket.send(JSON.stringify({ type: "result", id: envelope.id, ok: true, data }));
		});
	});
}

async function openStubbed(browser: Browser): Promise<{ stubbed: Page; stubbedErrors: string[] }> {
	const context = await browser.newContext({
		baseURL: "http://127.0.0.1:8787",
		viewport: { width: 1400, height: 900 },
		colorScheme: "dark",
	});
	const stubbed = await context.newPage();
	const stubbedErrors = collectErrors(stubbed);
	await stubHost(stubbed);
	await stubbed.addInitScript((seen) => localStorage.setItem("tau.seen", JSON.stringify(seen)), MOCK_SEEN);
	await stubbed.goto("/", { waitUntil: "networkidle" });
	await expect(stubbed.getByTestId("session-item")).toHaveCount(MOCK_SESSIONS.length);
	return { stubbed, stubbedErrors };
}

test("the five circles show up side by side, in both themes, with a legend", async ({ browser }) => {
	const { stubbed, stubbedErrors } = await openStubbed(browser);
	try {
		for (const [id, status] of Object.entries(EXPECTED)) {
			const row = stubbed.locator(`[data-session-path="/tmp/tau-mock/${id}.jsonl"]`);
			await expect(row.getByTestId("session-status")).toHaveAttribute("data-status", status);
		}
		// Only the two states that are still moving breathe.
		await expect(stubbed.locator('[data-status="working"]')).toHaveClass(/animate-glow/);
		await expect(stubbed.locator('[data-status="needsInput"]')).toHaveClass(/animate-glow-slow/);
		await expect(stubbed.locator('[data-status="unseen"]')).not.toHaveClass(/animate/);
		// The circle names its state for screen readers and on hover.
		await expect(stubbed.locator('[data-status="error"]')).toHaveAttribute("title", "Last run failed");
		await expect(stubbed.locator('[data-status="unseen"]')).toHaveAttribute("aria-label", "Changed since you looked");
		await stubbed.screenshot({ path: `${SHOTS}/112-status-five-states.png`, animations: "disabled" });

		// Same circles in light mode.
		await stubbed.getByRole("button", { name: "Switch to light mode" }).first().click();
		await expect(stubbed.locator("html")).not.toHaveClass(/dark/);
		await stubbed
			.locator("aside")
			.first()
			.screenshot({ path: `${SHOTS}/113-status-five-states-light.png`, animations: "disabled" });
		await stubbed.getByRole("button", { name: "Switch to dark mode" }).first().click();

		// ? opens the shortcut overview, which is where the circles are explained.
		await stubbed.keyboard.press("?");
		const dialog = stubbed.getByTestId("hotkeys-dialog");
		await expect(dialog).toBeVisible();
		const legend = dialog.getByTestId("status-legend");
		await expect(legend.getByTestId("legend-row")).toHaveCount(5);
		await expect(legend).toContainText("Waiting for an answer");
		await expect(legend).toContainText("Changed since you looked");
		await stubbed.screenshot({ path: `${SHOTS}/114-status-legend.png`, animations: "disabled" });
		expect(stubbedErrors).toEqual([]);
	} finally {
		await stubbed.context().close();
	}
});

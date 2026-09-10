import { existsSync } from "node:fs";
import { expect, type Locator, type Page } from "@playwright/test";

export const IDLE_PLACEHOLDER = /^Message pi/;

/** The composer textarea, whatever its placeholder currently says. */
export function composer(page: Page): Locator {
	return page.locator("textarea").first();
}

/** Console and page errors collected from the moment of the call. */
export function collectErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(`console: ${message.text().slice(0, 300)}`);
	});
	page.on("pageerror", (error) => errors.push(`pageerror: ${error.message.slice(0, 300)}`));
	return errors;
}

export async function isIdle(page: Page): Promise<boolean> {
	const placeholder = await composer(page)
		.getAttribute("placeholder")
		.catch(() => null);
	return placeholder !== null && IDLE_PLACEHOLDER.test(placeholder);
}

/** Send a prompt and wait until the run has started (the placeholder changes). */
export async function sendPrompt(page: Page, text: string): Promise<void> {
	await composer(page).fill(text);
	await composer(page).press("Enter");
	await expect(composer(page)).not.toHaveAttribute("placeholder", IDLE_PLACEHOLDER);
}

/**
 * Wait for the run to finish. Approval dialogs that appear meanwhile are answered with
 * `answerApproval` (the model may ask more than once).
 */
export async function untilIdle(
	page: Page,
	answerApproval?: (dialog: Locator) => Promise<void>,
	timeoutMs = 200_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const dialog = page.getByTestId("ui-request");
		if (answerApproval && (await dialog.isVisible())) {
			await answerApproval(dialog);
			await page.waitForTimeout(500);
			continue;
		}
		if (await isIdle(page)) return;
		await page.waitForTimeout(500);
	}
	throw new Error(`run did not finish within ${timeoutMs} ms`);
}

/** Open the app and wait for the session list to be loaded. */
export async function openApp(page: Page): Promise<void> {
	await page.goto("/", { waitUntil: "networkidle" });
	await expect(page.getByRole("button", { name: /New session/ }).first()).toBeVisible();
	await page.waitForTimeout(500);
}

/**
 * Show the newest session of a project whose directory still exists. Sessions of deleted
 * projects stay listed, and a terminal cannot be opened in a directory that is gone.
 * The host runs on this machine, so the test can check the directories itself.
 */
export async function openLiveProjectSession(page: Page): Promise<string> {
	const groups = page.getByTestId("project-group");
	const count = await groups.count();
	for (let index = 0; index < count; index++) {
		const group = groups.nth(index);
		const cwd = await group.getAttribute("data-project-cwd");
		if (!cwd || !existsSync(cwd)) continue;
		const item = group.getByTestId("session-item").first();
		if ((await item.count()) === 0) continue;
		await item.click();
		await expect(composer(page)).toBeVisible({ timeout: 30_000 });
		await page.waitForTimeout(500);
		return cwd;
	}
	throw new Error("no listed session has an existing project directory");
}

/**
 * Record a trust decision for a project. pi's own terminal UI stops at a trust question when a
 * directory ships `.pi` resources and has no decision yet, which no test can answer blindly.
 */
export async function trustProject(page: Page, cwd: string): Promise<void> {
	await page.evaluate(async (dir) => {
		const socket = new WebSocket(`ws://${location.host}/ws`);
		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => resolve();
			socket.onerror = () => reject(new Error("host socket failed"));
		});
		// TAU_PROTOCOL_VERSION; the host refuses a hello with another version.
		socket.send(JSON.stringify({ type: "hello", protocolVersion: 1 }));
		await new Promise<void>((resolve) => {
			socket.onmessage = (event) => {
				const envelope = JSON.parse(String(event.data)) as { type?: string; id?: string };
				if (envelope.type === "result" && envelope.id === "trust") resolve();
			};
			socket.send(
				JSON.stringify({ type: "cmd", id: "trust", command: { type: "trust.set", cwd: dir, trusted: true } }),
			);
		});
		socket.close();
	}, cwd);
}

/** Toast area of the app; the newest message is the last entry. */
export function toasts(page: Page): Locator {
	return page.getByLabel("Notifications");
}

/**
 * Queue steering and follow-up messages in a named session without any model run: pi accepts
 * both while it is idle, and the host broadcasts the queue to every subscriber, so the page
 * under test shows them. Keeps the suite free of extra LLM prompts.
 */
export async function queueMessages(
	page: Page,
	sessionName: string,
	steering: string[],
	followUp: string[],
): Promise<void> {
	await page.evaluate(
		async ({ sessionName, steering, followUp }) => {
			const socket = new WebSocket(`ws://${location.host}/ws`);
			await new Promise<void>((resolve, reject) => {
				socket.onopen = () => resolve();
				socket.onerror = () => reject(new Error("host socket failed"));
			});
			// TAU_PROTOCOL_VERSION; the host refuses a hello with another version.
			socket.send(JSON.stringify({ type: "hello", protocolVersion: 1 }));
			const pending = new Map<string, (data: unknown) => void>();
			socket.onmessage = (event) => {
				const envelope = JSON.parse(String(event.data)) as { type?: string; id?: string; data?: unknown };
				if (envelope.type !== "result" || typeof envelope.id !== "string") return;
				pending.get(envelope.id)?.(envelope.data);
				pending.delete(envelope.id);
			};
			let seq = 0;
			const request = (envelope: Record<string, unknown>): Promise<unknown> => {
				const id = `q${seq++}`;
				return new Promise((resolve) => {
					pending.set(id, resolve);
					socket.send(JSON.stringify({ type: "cmd", id, ...envelope }));
				});
			};
			const sessions = (await request({ command: { type: "sessions.list" } })) as {
				id: string;
				name?: string;
				handle?: string;
			}[];
			const session = sessions.find((entry) => entry.name === sessionName);
			if (!session) throw new Error(`no session named ${sessionName}`);
			const sessionId = session.handle ?? session.id;
			// One at a time so the queue keeps the order they were sent in.
			for (const message of steering) await request({ sessionId, command: { type: "steer", message } });
			for (const message of followUp) await request({ sessionId, command: { type: "followUp", message } });
			socket.close();
		},
		{ sessionName, steering, followUp },
	);
}

/** The rendered xterm buffer of the shown terminal; only visible rows are in the DOM. */
export function terminalRows(page: Page): Locator {
	return page.locator("[data-testid=terminal-surface] .xterm-rows");
}

/** Type into the shown terminal and submit. */
export async function terminalType(page: Page, text: string): Promise<void> {
	await page.getByTestId("terminal-surface").click();
	await page.keyboard.type(text);
	await page.keyboard.press("Enter");
}

/**
 * Close every terminal the host still runs so a terminal test starts from a clean panel:
 * terminals outlive the browser session by design and would otherwise be adopted as tabs.
 */
export async function closeHostTerminals(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const socket = new WebSocket(`ws://${location.host}/ws`);
		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => resolve();
			socket.onerror = () => reject(new Error("host socket failed"));
		});
		// TAU_PROTOCOL_VERSION; the host refuses a hello with another version.
		socket.send(JSON.stringify({ type: "hello", protocolVersion: 1 }));
		const terminals = await new Promise<{ id: string }[]>((resolve) => {
			socket.onmessage = (event) => {
				const envelope = JSON.parse(String(event.data)) as { type?: string; id?: string; data?: unknown };
				if (envelope.type === "result" && envelope.id === "list") resolve((envelope.data as { id: string }[]) ?? []);
			};
			socket.send(JSON.stringify({ type: "cmd", id: "list", command: { type: "terminal.list" } }));
		});
		for (const [index, terminal] of terminals.entries()) {
			const command = { type: "terminal.close", terminalId: terminal.id };
			socket.send(JSON.stringify({ type: "cmd", id: `close-${index}`, command }));
		}
		await new Promise((resolve) => setTimeout(resolve, 300));
		socket.close();
	});
}

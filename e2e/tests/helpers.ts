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
 * Record a trust decision for a project. pi's own terminal UI stops at a trust question when a
 * directory ships `.pi` resources and has no decision yet, which no test can answer blindly.
 */
export async function trustProject(page: Page, cwd: string, trusted: boolean | null = true): Promise<void> {
	await page.evaluate(
		async ({ dir, decision }) => {
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
					JSON.stringify({ type: "cmd", id: "trust", command: { type: "trust.set", cwd: dir, trusted: decision } }),
				);
			});
			socket.close();
		},
		{ dir: cwd, decision: trusted },
	);
}

/**
 * Name for a session this suite creates. The shape is the contract `deleteE2eSessions`
 * matches on, so every spec must build its name with this helper.
 */
export function e2eSessionName(kind: string): string {
	const time = new Date().toISOString().slice(11, 19);
	return kind ? `tau ${kind} e2e ${time}` : `tau e2e ${time}`;
}

/** Prefix of every sidebar group this suite makes; `deleteE2eGroups` matches on it. */
export const E2E_GROUP_PREFIX = "tau e2e group";

/**
 * Delete every sidebar group this suite created. Matches on the name prefix only, so a group
 * the user made keeps standing; deleting a group never touches its sessions.
 */
export async function deleteE2eGroups(page: Page): Promise<number> {
	return page.evaluate(async (prefix) => {
		const socket = new WebSocket(`ws://${location.host}/ws`);
		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => resolve();
			socket.onerror = () => reject(new Error("host socket failed"));
		});
		let id = 0;
		const pending = new Map<string, (data: unknown) => void>();
		socket.onmessage = (event) => {
			const envelope = JSON.parse(String(event.data)) as { type?: string; id?: string; ok?: boolean; data?: unknown };
			if (envelope.type !== "result" || !envelope.id) return;
			pending.get(envelope.id)?.(envelope.ok ? envelope.data : undefined);
			pending.delete(envelope.id);
		};
		const send = (command: unknown): Promise<unknown> =>
			new Promise((resolve) => {
				const key = String(++id);
				pending.set(key, resolve);
				socket.send(JSON.stringify({ type: "cmd", id: key, command }));
			});
		// TAU_PROTOCOL_VERSION; the host refuses a hello with another version.
		socket.send(JSON.stringify({ type: "hello", protocolVersion: 1 }));
		// groups.list answers with the whole state: the groups and the names given to projects.
		const state = (await send({ type: "groups.list" })) as { groups?: { id: string; name: string }[] } | undefined;
		const groups = state?.groups ?? [];
		let removed = 0;
		for (const group of groups) {
			if (!group.name.startsWith(prefix)) continue;
			await send({ type: "groups.delete", id: group.id });
			removed++;
		}
		socket.close();
		return removed;
	}, E2E_GROUP_PREFIX);
}

/**
 * Drop the name the suite gave a project group, so the sidebar shows the folder name again.
 * Runs whatever the tests did, so a failed assertion cannot leave a renamed project behind.
 */
export async function resetProjectName(page: Page, cwd: string): Promise<void> {
	await page.evaluate(async (dir) => {
		const socket = new WebSocket(`ws://${location.host}/ws`);
		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => resolve();
			socket.onerror = () => reject(new Error("host socket failed"));
		});
		socket.send(JSON.stringify({ type: "hello", protocolVersion: 1 }));
		socket.send(
			JSON.stringify({ type: "cmd", id: "reset", command: { type: "groups.renameProject", cwd: dir, name: null } }),
		);
		await new Promise<void>((resolve) => {
			socket.onmessage = (event) => {
				const envelope = JSON.parse(String(event.data)) as { type?: string; id?: string };
				if (envelope.type === "result" && envelope.id === "reset") resolve();
			};
		});
		socket.close();
	}, cwd);
}

/**
 * Delete every session this suite created, so a test run leaves the machine as it found it.
 * Matches on the name only: a session the user wrote is never touched, whatever it contains.
 */
export async function deleteE2eSessions(page: Page): Promise<number> {
	return page.evaluate(async () => {
		const socket = new WebSocket(`ws://${location.host}/ws`);
		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => resolve();
			socket.onerror = () => reject(new Error("host socket failed"));
		});
		let id = 0;
		const pending = new Map<string, (data: unknown) => void>();
		socket.onmessage = (event) => {
			const envelope = JSON.parse(String(event.data)) as { type?: string; id?: string; ok?: boolean; data?: unknown };
			if (envelope.type !== "result" || !envelope.id) return;
			pending.get(envelope.id)?.(envelope.ok ? envelope.data : undefined);
			pending.delete(envelope.id);
		};
		const send = (command: unknown): Promise<unknown> =>
			new Promise((resolve) => {
				const key = String(++id);
				pending.set(key, resolve);
				socket.send(JSON.stringify({ type: "cmd", id: key, command }));
			});
		socket.send(JSON.stringify({ type: "hello", protocolVersion: 1 }));
		const sessions = ((await send({ type: "sessions.list" })) ?? []) as {
			name?: string;
			path: string;
			handle?: string;
			running: boolean;
		}[];
		let removed = 0;
		for (const session of sessions) {
			if (!/^tau (\w+ )?e2e \d{2}:\d{2}:\d{2}$/.test(session.name ?? "")) continue;
			if (session.running && session.handle) await send({ type: "sessions.close", sessionId: session.handle });
			if (!session.path.startsWith("pending:")) await send({ type: "sessions.delete", sessionPath: session.path });
			removed++;
		}
		socket.close();
		return removed;
	});
}

/**
 * Stop the processes of ephemeral sessions. They write no file, so nothing is left on disk,
 * but their pi process would idle on until the host's timeout.
 */
export async function closeEphemeralSessions(page: Page): Promise<number> {
	return page.evaluate(async () => {
		const socket = new WebSocket(`ws://${location.host}/ws`);
		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => resolve();
			socket.onerror = () => reject(new Error("host socket failed"));
		});
		let id = 0;
		const pending = new Map<string, (data: unknown) => void>();
		socket.onmessage = (event) => {
			const envelope = JSON.parse(String(event.data)) as { type?: string; id?: string; ok?: boolean; data?: unknown };
			if (envelope.type !== "result" || !envelope.id) return;
			pending.get(envelope.id)?.(envelope.ok ? envelope.data : undefined);
			pending.delete(envelope.id);
		};
		const send = (command: unknown): Promise<unknown> =>
			new Promise((resolve) => {
				const key = String(++id);
				pending.set(key, resolve);
				socket.send(JSON.stringify({ type: "cmd", id: key, command }));
			});
		socket.send(JSON.stringify({ type: "hello", protocolVersion: 1 }));
		const sessions = ((await send({ type: "sessions.list" })) ?? []) as {
			ephemeral?: boolean;
			handle?: string;
			running: boolean;
		}[];
		let closed = 0;
		for (const session of sessions) {
			if (!session.ephemeral || !session.running || !session.handle) continue;
			await send({ type: "sessions.close", sessionId: session.handle });
			closed++;
		}
		socket.close();
		return closed;
	});
}

/** Delete every session of one project directory. For specs that create their own project. */
export async function deleteSessionsOfProject(page: Page, cwd: string): Promise<number> {
	return page.evaluate(async (dir) => {
		const socket = new WebSocket(`ws://${location.host}/ws`);
		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => resolve();
			socket.onerror = () => reject(new Error("host socket failed"));
		});
		let id = 0;
		const pending = new Map<string, (data: unknown) => void>();
		socket.onmessage = (event) => {
			const envelope = JSON.parse(String(event.data)) as { type?: string; id?: string; ok?: boolean; data?: unknown };
			if (envelope.type !== "result" || !envelope.id) return;
			pending.get(envelope.id)?.(envelope.ok ? envelope.data : undefined);
			pending.delete(envelope.id);
		};
		const send = (command: unknown): Promise<unknown> =>
			new Promise((resolve) => {
				const key = String(++id);
				pending.set(key, resolve);
				socket.send(JSON.stringify({ type: "cmd", id: key, command }));
			});
		socket.send(JSON.stringify({ type: "hello", protocolVersion: 1 }));
		const sessions = ((await send({ type: "sessions.list", cwd: dir })) ?? []) as {
			path: string;
			handle?: string;
			running: boolean;
		}[];
		let removed = 0;
		for (const session of sessions) {
			if (session.running && session.handle) await send({ type: "sessions.close", sessionId: session.handle });
			if (!session.path.startsWith("pending:")) await send({ type: "sessions.delete", sessionPath: session.path });
			removed++;
		}
		socket.close();
		return removed;
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

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	collectErrors,
	composer,
	deleteE2eGroups,
	deleteE2eSessions,
	E2E_GROUP_PREFIX,
	e2eSessionName,
	openApp,
	resetProjectName,
} from "./helpers";

/**
 * Sidebar groups: making them, filing a session by dragging, both context menus, renaming,
 * reordering and deleting. No LLM prompt anywhere — the session under test is imported from a
 * minimal pi session file, and everything else is host bookkeeping.
 *
 * The suite deletes its own sessions and its own groups afterwards; a group the user made is
 * never touched, and deleting a group leaves its sessions alone anyway.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = "/srv/pi-tau/e2e/shots";
const CWD = "/srv/pi-tau";
const SESSION_NAME = e2eSessionName("groups");
const SECOND_SESSION = e2eSessionName("newsession");
const GROUP_A = `${E2E_GROUP_PREFIX} A`;
const GROUP_B = `${E2E_GROUP_PREFIX} B`;
const GROUP_RENAMED = `${E2E_GROUP_PREFIX} A renamed`;
const PROJECT_NAME = "tau e2e project name";

let page: Page;
let errors: string[];

/** The block of the sidebar the user made, by name. */
function userGroup(name: string): Locator {
	return page.getByTestId("session-group").filter({ has: page.getByTestId("group-header").getByText(name) });
}

/** Names of the user groups, top to bottom. The header renders them uppercase. */
async function groupOrder(): Promise<string[]> {
	const names = await page.getByTestId("session-group").getByTestId("group-header").allInnerTexts();
	return names.map((entry) => (entry.split("\n")[0] ?? "").toLowerCase());
}

function row(name = SESSION_NAME): Locator {
	return page.getByTestId("session-item").filter({ hasText: name }).first();
}

function projectGroup(): Locator {
	return page.locator(`[data-project-cwd="${CWD}"]`);
}

/** Right-click and wait for the menu that belongs to the target. */
async function openMenu(target: Locator, testId: string): Promise<Locator> {
	await target.click({ button: "right" });
	const menu = page.getByTestId(testId);
	await expect(menu).toBeVisible();
	return menu;
}

/**
 * Right-click the scroll area a little below the last group, which is the sidebar's own empty
 * space. A packed sidebar has none, and the assertion says so instead of clicking a row.
 */
async function rightClickBelowTheList(): Promise<void> {
	const list = await page.getByTestId("sidebar-list").boundingBox();
	const area = await page.getByTestId("sidebar-scroll").boundingBox();
	if (!list || !area) throw new Error("sidebar not laid out");
	const y = list.y + list.height + 12;
	expect(y).toBeLessThan(area.y + area.height);
	await page.mouse.click(area.x + 20, y, { button: "right" });
}

/** Make a group through the "New group…" item of a menu that is already open. */
async function createGroup(name: string): Promise<void> {
	await page.getByRole("menuitem", { name: "New group" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await dialog.getByRole("textbox").fill(name);
	await dialog.getByRole("button", { name: "Create" }).click();
	await expect(dialog).toBeHidden();
	await expect(userGroup(name)).toBeVisible();
}

/**
 * A session of this suite's own, imported from a minimal but real pi session file.
 *
 * A session pi has not written to disk yet is listed from its live process, and the host
 * reports those without their group; a session with a file behaves like every real one.
 */
async function importSession(name: string): Promise<void> {
	const id = randomUUID();
	const timestamp = new Date().toISOString();
	const entries = [
		{ type: "session", version: 3, id, timestamp, cwd: CWD },
		{ type: "session_info", id: "e2e-info", parentId: null, timestamp, name },
		{
			type: "message",
			id: "e2e-message",
			parentId: "e2e-info",
			timestamp,
			message: { role: "user", content: [{ type: "text", text: "tau e2e fixture session" }], timestamp: Date.now() },
		},
	];
	const dir = mkdtempSync(join(tmpdir(), "tau-e2e-groups-"));
	const file = join(dir, `${id}.jsonl`);
	writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
	try {
		await page.evaluate(async (sourcePath) => {
			const socket = new WebSocket(`ws://${location.host}/ws`);
			await new Promise<void>((resolve, reject) => {
				socket.onopen = () => resolve();
				socket.onerror = () => reject(new Error("host socket failed"));
			});
			// TAU_PROTOCOL_VERSION; the host refuses a hello with another version.
			socket.send(JSON.stringify({ type: "hello", protocolVersion: 1 }));
			await new Promise<void>((resolve, reject) => {
				socket.onmessage = (event) => {
					const envelope = JSON.parse(String(event.data)) as { type?: string; id?: string; ok?: boolean };
					if (envelope.type !== "result" || envelope.id !== "import") return;
					if (envelope.ok) resolve();
					else reject(new Error("import refused"));
				};
				socket.send(JSON.stringify({ type: "cmd", id: "import", command: { type: "sessions.import", sourcePath } }));
			});
			socket.close();
		}, file);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	await expect(row(name)).toBeVisible();
}

/**
 * HTML5 drag and drop dispatched as its own events, one step per call so React has rendered
 * the state of the previous step — which is what makes the "hovering a group" look observable.
 * The real mouse drag is exercised too, by `dragTo` further down.
 */
interface DragHandoff {
	source: Element;
	target?: Element;
	dataTransfer: DataTransfer;
}

async function dragStart(from: string): Promise<void> {
	await page.evaluate((selector) => {
		const source = document.querySelector(selector);
		if (!source) throw new Error(`no drag source ${selector}`);
		const dataTransfer = new DataTransfer();
		(window as Window & { __tauDrag?: DragHandoff }).__tauDrag = { source, dataTransfer };
		source.dispatchEvent(new DragEvent("dragstart", { dataTransfer, bubbles: true, cancelable: true }));
	}, from);
}

async function dragOver(to: string): Promise<void> {
	await page.evaluate((selector) => {
		const drag = (window as Window & { __tauDrag?: DragHandoff }).__tauDrag;
		const target = document.querySelector(selector);
		if (!drag || !target) throw new Error(`no drag over ${selector}`);
		drag.target = target;
		target.dispatchEvent(
			new DragEvent("dragover", { dataTransfer: drag.dataTransfer, bubbles: true, cancelable: true }),
		);
	}, to);
}

async function dropOn(): Promise<void> {
	await page.evaluate(() => {
		const drag = (window as Window & { __tauDrag?: DragHandoff }).__tauDrag;
		if (!drag?.target) throw new Error("no drag in progress");
		const fire = (element: Element, type: string) =>
			element.dispatchEvent(new DragEvent(type, { dataTransfer: drag.dataTransfer, bubbles: true, cancelable: true }));
		fire(drag.target, "drop");
		fire(drag.source, "dragend");
	});
}

test.beforeAll(async ({ browser }) => {
	page = await browser.newPage();
	errors = collectErrors(page);
	await openApp(page);
});

test.afterAll(async () => {
	// Only this suite's own sessions and its own groups; the machine's stay untouched.
	await deleteE2eSessions(page);
	await deleteE2eGroups(page);
	// Whatever happened above, the project shows its folder name again.
	await resetProjectName(page, CWD);
	await page.close();
});

test("a project header and the empty space below the list both make a group", async () => {
	await importSession(SESSION_NAME);

	// The project header offers what a project can offer: a session, a name and a group.
	const projectMenu = await openMenu(projectGroup().getByTestId("group-header").first(), "group-context-menu");
	await expect(projectMenu.getByRole("menuitem", { name: "New session here" })).toBeVisible();
	await expect(projectMenu.getByRole("menuitem", { name: "Rename group" })).toBeVisible();
	await expect(projectMenu.getByRole("menuitem", { name: "Delete group" })).toHaveCount(0);
	await createGroup(GROUP_A);

	// The empty space below the last group offers the same two entries.
	await rightClickBelowTheList();
	const listMenu = page.getByTestId("sidebar-context-menu");
	await expect(listMenu).toBeVisible();
	await expect(listMenu.getByRole("menuitem", { name: "New session" })).toBeVisible();
	await createGroup(GROUP_B);

	// Both groups stand above the project groups, in the order they were made, and say so.
	await expect(page.getByTestId("session-group")).toHaveCount(2);
	expect(await groupOrder()).toEqual([GROUP_A, GROUP_B].map((name) => name.toLowerCase()));
	await expect(userGroup(GROUP_A).getByTestId("group-drop-hint")).toHaveText("Drag sessions here");
	await expect(userGroup(GROUP_B).getByTestId("group-drop-hint")).toBeVisible();
	await page
		.locator("aside")
		.first()
		.screenshot({ path: `${SHOTS}/130-groups-two-empty.png`, animations: "disabled" });
	expect(errors).toEqual([]);
});

test("a project header starts a session in its own directory", async () => {
	const projectMenu = await openMenu(projectGroup().getByTestId("group-header").first(), "group-context-menu");
	await projectMenu.getByRole("menuitem", { name: "New session here" }).click();
	await expect(composer(page)).toBeVisible({ timeout: 30_000 });
	// Named through pi's own command, so no model is involved and the cleanup finds it again.
	await composer(page).fill(`/name ${SECOND_SESSION}`);
	await composer(page).press("Enter");
	await expect(page.locator("header").getByText(SECOND_SESSION)).toBeVisible();
	await expect(projectGroup().getByTestId("session-item").filter({ hasText: SECOND_SESSION })).toHaveCount(1);
	expect(errors).toEqual([]);
});

test("dragging a session onto a group files it there, and a reload keeps it", async () => {
	const path = await row().getAttribute("data-session-path");
	expect(path).not.toBeNull();
	const rowSelector = `[data-session-path="${path}"]`;
	// The dispatched drag runs inside the page, so both ends need plain CSS.
	const groupId = await userGroup(GROUP_A).getAttribute("data-group-id");
	const groupSelector = `[data-group-id="${groupId}"]`;

	// Hovering the group with a session in hand marks the row and lights the group up.
	await dragStart(rowSelector);
	await expect(row()).toHaveAttribute("data-dragging", "true");
	await dragOver(groupSelector);
	await expect(userGroup(GROUP_A)).toHaveAttribute("data-drop-active", "true");
	await page
		.locator("aside")
		.first()
		.screenshot({ path: `${SHOTS}/131-groups-drag-hover.png`, animations: "disabled" });

	await dropOn();
	await expect(userGroup(GROUP_A).getByTestId("session-item").filter({ hasText: SESSION_NAME })).toHaveCount(1);
	await expect(userGroup(GROUP_A).getByTestId("group-drop-hint")).toHaveCount(0);
	await expect(projectGroup().getByTestId("session-item").filter({ hasText: SESSION_NAME })).toHaveCount(0);

	// The host keeps the assignment, so a reload — and another browser — sees the same.
	await page.reload({ waitUntil: "networkidle" });
	await expect(page.getByRole("button", { name: /New session/ }).first()).toBeVisible();
	await expect(userGroup(GROUP_A).getByTestId("session-item").filter({ hasText: SESSION_NAME })).toHaveCount(1);
	expect(errors).toEqual([]);
});

test("the mouse drag moves the session on and back again", async () => {
	// Playwright's dragTo drives the real mouse, which Chromium turns into a native drag.
	await row().dragTo(userGroup(GROUP_B).getByTestId("group-header"));
	await expect(userGroup(GROUP_B).getByTestId("session-item").filter({ hasText: SESSION_NAME })).toHaveCount(1);
	await expect(userGroup(GROUP_A).getByTestId("group-drop-hint")).toBeVisible();

	// And back into the first group, this time dropped on its body instead of its header.
	await row().dragTo(userGroup(GROUP_A));
	await expect(userGroup(GROUP_A).getByTestId("session-item").filter({ hasText: SESSION_NAME })).toHaveCount(1);

	// A drop on a project header takes the session out of its group again.
	await row().dragTo(projectGroup().getByTestId("group-header").first());
	await expect(projectGroup().getByTestId("session-item").filter({ hasText: SESSION_NAME })).toHaveCount(1);
	await expect(userGroup(GROUP_A).getByTestId("group-drop-hint")).toBeVisible();

	// Back into the first group; the rest of the suite expects it there.
	await row().dragTo(userGroup(GROUP_A).getByTestId("group-header"));
	await expect(userGroup(GROUP_A).getByTestId("session-item").filter({ hasText: SESSION_NAME })).toHaveCount(1);
	expect(errors).toEqual([]);
});

test("a folded group stays folded after a reload", async () => {
	await expect(userGroup(GROUP_A).getByTestId("session-item")).toHaveCount(1);
	await userGroup(GROUP_A).getByTestId("group-header").click();
	await expect(userGroup(GROUP_A).getByTestId("session-item")).toHaveCount(0);

	// Folding is this browser's own business, and it is remembered per group.
	await page.reload({ waitUntil: "networkidle" });
	await expect(page.getByRole("button", { name: /New session/ }).first()).toBeVisible();
	await expect(userGroup(GROUP_A).getByTestId("session-item")).toHaveCount(0);
	await expect(projectGroup().getByTestId("session-item").first()).toBeVisible();

	await userGroup(GROUP_A).getByTestId("group-header").click();
	await expect(userGroup(GROUP_A).getByTestId("session-item")).toHaveCount(1);
	expect(errors).toEqual([]);
});

test("the row's right-click menu offers the same items as its … menu", async () => {
	const menu = await openMenu(row(), "session-context-menu");
	for (const label of ["Open", "Rename", "Move to group", "Clone session", "Export HTML", "Download JSONL", "Delete"]) {
		await expect(menu.getByRole("menuitem", { name: label })).toBeVisible();
	}
	// The submenu lists every group, ticks the one the session sits in, and can make a new one.
	await menu.getByRole("menuitem", { name: "Move to group" }).hover();
	const submenu = page.getByRole("menu").last();
	await expect(submenu.getByRole("menuitem", { name: GROUP_A })).toBeVisible();
	await expect(submenu.getByRole("menuitem", { name: "No group" })).toBeVisible();
	await expect(submenu.getByRole("menuitem", { name: "New group" })).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/132-groups-session-menu.png`, animations: "disabled" });
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("session-context-menu")).toHaveCount(0);

	// The "…" button of the same row shows the same list. It sits next to the row's own button.
	await row().hover();
	await userGroup(GROUP_A).getByRole("button", { name: "Session actions" }).first().click();
	const dropdown = page.getByRole("menu").first();
	await expect(dropdown.getByRole("menuitem", { name: "Move to group" })).toBeVisible();
	await expect(dropdown.getByRole("menuitem", { name: "Clone session" })).toBeVisible();
	await page.keyboard.press("Escape");
	expect(errors).toEqual([]);
});

test("a group is renamed in its header and moved with its own menu", async () => {
	const menu = await openMenu(userGroup(GROUP_A).getByTestId("group-header"), "group-context-menu");
	for (const label of ["New session here", "Rename group", "New group", "Move down", "Delete group"]) {
		await expect(menu.getByRole("menuitem", { name: label })).toBeVisible();
	}
	// The first group cannot go further up.
	await expect(menu.getByRole("menuitem", { name: "Move up" })).toHaveCount(0);
	await page.screenshot({ path: `${SHOTS}/133-groups-group-menu.png`, animations: "disabled" });

	// Renaming happens inline in the header.
	await menu.getByRole("menuitem", { name: "Rename group" }).click();
	const input = page.getByTestId("group-name-input");
	await expect(input).toBeVisible();
	await input.fill(GROUP_RENAMED);
	await input.press("Enter");
	await expect(userGroup(GROUP_RENAMED).getByTestId("group-header")).toBeVisible();

	const order = async () => (await groupOrder()).join(" | ");
	const renamedFirst = [GROUP_RENAMED, GROUP_B].map((name) => name.toLowerCase()).join(" | ");
	const renamedSecond = [GROUP_B, GROUP_RENAMED].map((name) => name.toLowerCase()).join(" | ");
	expect(await order()).toBe(renamedFirst);

	// Move down, and the second group is on top.
	const renamedMenu = await openMenu(userGroup(GROUP_RENAMED).getByTestId("group-header"), "group-context-menu");
	await renamedMenu.getByRole("menuitem", { name: "Move down" }).click();
	await expect.poll(order).toBe(renamedSecond);

	// And back up again, so the reordering is proven in both directions.
	const movedMenu = await openMenu(userGroup(GROUP_RENAMED).getByTestId("group-header"), "group-context-menu");
	await movedMenu.getByRole("menuitem", { name: "Move up" }).click();
	await expect.poll(order).toBe(renamedFirst);

	// A reload proves the host stored both the name and the order.
	await page.reload({ waitUntil: "networkidle" });
	await expect(page.getByRole("button", { name: /New session/ }).first()).toBeVisible();
	expect(await order()).toBe(renamedFirst);
	expect(errors).toEqual([]);
});

test("a project header is renamed too, and can take its folder name back", async () => {
	const menu = await openMenu(projectGroup().getByTestId("group-header"), "group-context-menu");
	// A project group is not the user's to reorder or delete, but it is theirs to name.
	await expect(menu.getByRole("menuitem", { name: "Rename group" })).toBeVisible();
	await expect(menu.getByRole("menuitem", { name: "Move down" })).toHaveCount(0);
	await expect(menu.getByRole("menuitem", { name: "Delete group" })).toHaveCount(0);
	await expect(menu.getByRole("menuitem", { name: "Use the folder name" })).toHaveCount(0);

	await menu.getByRole("menuitem", { name: "Rename group" }).click();
	const input = page.getByTestId("group-name-input");
	await expect(input).toBeVisible();
	await input.fill(PROJECT_NAME);
	await input.press("Enter");
	const header = projectGroup().getByTestId("group-header");
	await expect(header).toContainText(PROJECT_NAME);
	await page.screenshot({ path: `${SHOTS}/134-groups-project-renamed.png`, animations: "disabled" });

	// The name lives on the host, against the directory, so another page load shows it.
	await page.reload({ waitUntil: "networkidle" });
	await expect(page.getByRole("button", { name: /New session/ }).first()).toBeVisible();
	await expect(projectGroup().getByTestId("group-header")).toContainText(PROJECT_NAME);

	// Only a project that carries a name of its own offers to drop it again.
	const named = await openMenu(projectGroup().getByTestId("group-header"), "group-context-menu");
	await named.getByRole("menuitem", { name: "Use the folder name" }).click();
	await expect(projectGroup().getByTestId("group-header")).toContainText("pi-tau");
	await page.reload({ waitUntil: "networkidle" });
	await expect(page.getByRole("button", { name: /New session/ }).first()).toBeVisible();
	await expect(projectGroup().getByTestId("group-header")).toContainText("pi-tau");
	expect(errors).toEqual([]);
});

test("deleting a group puts its session back under its project", async () => {
	const menu = await openMenu(userGroup(GROUP_RENAMED).getByTestId("group-header"), "group-context-menu");
	await menu.getByRole("menuitem", { name: "Delete group" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toContainText("fall back to their projects");
	await dialog.getByRole("button", { name: "Delete group" }).click();

	await expect(userGroup(GROUP_RENAMED)).toHaveCount(0);
	await expect(projectGroup().getByTestId("session-item").filter({ hasText: SESSION_NAME })).toHaveCount(1);

	// The empty second group goes the same way, so the run leaves no group behind.
	const secondMenu = await openMenu(userGroup(GROUP_B).getByTestId("group-header"), "group-context-menu");
	await secondMenu.getByRole("menuitem", { name: "Delete group" }).click();
	await page.getByRole("dialog").getByRole("button", { name: "Delete group" }).click();
	await expect(page.getByTestId("session-group")).toHaveCount(0);

	await page.reload({ waitUntil: "networkidle" });
	await expect(page.getByRole("button", { name: /New session/ }).first()).toBeVisible();
	await expect(page.getByTestId("session-group")).toHaveCount(0);
	await expect(projectGroup().getByTestId("session-item").filter({ hasText: SESSION_NAME })).toHaveCount(1);
	expect(errors).toEqual([]);
});

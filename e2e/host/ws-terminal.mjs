// Host smoke: open a shell terminal, run a command, then open pi's own TUI in a PTY and look for its banner.
const port = process.env.TAU_PORT ?? "8787";
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
const pending = new Map(); let n = 0; const data = new Map();
const send = (o) => ws.send(JSON.stringify(o));
const cmd = (command) => new Promise((resolve, reject) => { const id = String(++n); pending.set(id, { resolve, reject }); send({ type: "cmd", id, command }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (m) => {
	const env = JSON.parse(m.data);
	if (env.type === "result") { const p = pending.get(env.id); pending.delete(env.id); env.ok ? p.resolve(env.data) : p.reject(new Error(env.error.code + ": " + env.error.message)); }
	else if (env.type === "terminal.data") data.set(env.terminalId, (data.get(env.terminalId) ?? "") + env.data);
	else if (env.type === "terminal.exit") console.log("exit", env.terminalId.slice(0, 8), env.code);
};
const clean = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[=>]/g, "");
ws.onopen = async () => {
	try {
		send({ type: "hello", protocolVersion: 1 });
		const sh = await cmd({ type: "terminal.open", kind: "shell", cwd: "/srv/pi-tau", cols: 100, rows: 30 });
		await sleep(600); await cmd({ type: "terminal.input", terminalId: sh.id, data: "echo tau-term-$((6*7))\r" }); await sleep(800);
		console.log("shell output has tau-term-42:", clean(data.get(sh.id) ?? "").includes("tau-term-42"));
		await cmd({ type: "terminal.detach", terminalId: sh.id }); await cmd({ type: "terminal.input", terminalId: sh.id, data: "echo after-detach\r" }); await sleep(400);
		const before = (data.get(sh.id) ?? "").length; const re = await cmd({ type: "terminal.attach", terminalId: sh.id }); await sleep(300);
		console.log("re-attach replays scrollback with after-detach:", clean(data.get(sh.id) ?? "").includes("after-detach"), "| alive:", re.alive);
		await cmd({ type: "terminal.close", terminalId: sh.id });
		const pi = await cmd({ type: "terminal.open", kind: "pi", cwd: "/srv/pi-tau", cols: 120, rows: 40 });
		await sleep(6000);
		const out = clean(data.get(pi.id) ?? "");
		console.log("pi TUI bytes:", (data.get(pi.id) ?? "").length, "| mentions pi/model:", /pi|GLM|nebius/i.test(out), "| sample:", JSON.stringify(out.replace(/\s+/g, " ").slice(0, 160)));
		await cmd({ type: "terminal.input", terminalId: pi.id, data: "/quit\r" }); await sleep(1500);
		console.log("list:", (await cmd({ type: "terminal.list" })).map((t) => `${t.kind}:${t.alive}`));
		await cmd({ type: "terminal.close", terminalId: pi.id });
		ws.close(); process.exit(0);
	} catch (e) { console.error("TERMINAL SMOKE FAILED", e); process.exit(1); }
};

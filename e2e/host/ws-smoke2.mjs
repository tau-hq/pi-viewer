const ws = new WebSocket("ws://127.0.0.1:8787/ws");
const pending = new Map();
let n = 0;
let sessionId;
const waiters = [];
const counts = {};
let lastTranscript = [];
const send = (o) => ws.send(JSON.stringify(o));
const cmd = (command, sid) =>
	new Promise((resolve, reject) => {
		const id = String(++n);
		pending.set(id, { resolve, reject });
		send(sid ? { type: "cmd", id, sessionId: sid, command } : { type: "cmd", id, command });
	});
const waitFor = (pred, ms) =>
	new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error("timeout")), ms);
		waiters.push({
			pred,
			resolve: (v) => {
				clearTimeout(t);
				resolve(v);
			},
		});
	});
ws.onmessage = (m) => {
	const env = JSON.parse(m.data);
	if (env.type === "result") {
		const p = pending.get(env.id);
		pending.delete(env.id);
		env.ok ? p.resolve(env.data) : p.reject(new Error(env.error.code + ": " + env.error.message));
	} else if (env.type === "session.event") {
		const t = env.event.type;
		counts[t] = (counts[t] ?? 0) + 1;
		if (t === "ui.request") console.log("UI", JSON.stringify(env.event.request));
		if (t === "transcript.replace") lastTranscript = env.event.messages;
		if (t === "message.end")
			console.log("END", env.event.message.role, JSON.stringify(env.event.message.content).slice(0, 120));
	}
	for (const w of [...waiters])
		if (w.pred(env)) {
			waiters.splice(waiters.indexOf(w), 1);
			w.resolve(env);
		}
};
ws.onopen = async () => {
	try {
		send({ type: "hello", protocolVersion: 1 });
		await waitFor((e) => e.type === "hello", 5000);
		sessionId = (await cmd({ type: "sessions.create", cwd: "/srv/pi-tau" })).sessionId;
		send({ type: "subscribe", sessionId });
		await waitFor((e) => e.type === "session.snapshot", 5000);
		const commands = await cmd({ type: "getCommands" }, sessionId);
		console.log(
			"commands",
			commands.map((c) => c.name),
		);
		const tools = await cmd({ type: "tools.list" }, sessionId);
		console.log(
			"tools",
			tools.tools.map((t) => `${t.name}${t.active ? "" : "(off)"}`),
		);
		const set = await cmd({ type: "tools.set", names: tools.active.filter((t) => t !== "write") }, sessionId);
		console.log("after set", set.active);
		await cmd({ type: "tools.set", names: tools.active }, sessionId);
		const uiPromise = waitFor((e) => e.type === "session.event" && e.event.type === "ui.request", 120000);
		await cmd(
			{
				type: "prompt",
				message:
					"Fuehre mit dem bash-Werkzeug genau den Befehl `echo tau-ok` aus und nenne mir die Ausgabe in einem Satz.",
			},
			sessionId,
		);
		const ui = (await uiPromise).event.request;
		console.log("approval title:", JSON.stringify(ui.title), "options:", ui.options);
		await cmd({ type: "ui.response", response: { id: ui.id, value: "Allow once" } }, sessionId);
		await waitFor((e) => e.type === "session.event" && e.event.type === "run.settled", 180000);
		await waitFor((e) => e.type === "session.event" && e.event.type === "transcript.replace", 20000);
		const toolResult = lastTranscript.find((m) => m.role === "toolResult");
		console.log(
			"tool result contains tau-ok:",
			JSON.stringify(toolResult?.content).includes("tau-ok"),
			"| roles:",
			lastTranscript.map((m) => m.role).join(","),
		);
		const denyPromise = waitFor((e) => e.type === "session.event" && e.event.type === "ui.request", 120000);
		await cmd(
			{
				type: "prompt",
				message:
					"Fuehre mit dem bash-Werkzeug genau den Befehl `echo zweiter-test` aus. Falls es abgelehnt wird, antworte nur mit dem Wort ABGELEHNT.",
			},
			sessionId,
		);
		const deny = (await denyPromise).event.request;
		await cmd({ type: "ui.response", response: { id: deny.id, value: "Deny" } }, sessionId);
		await waitFor((e) => e.type === "session.event" && e.event.type === "run.settled", 180000);
		await waitFor((e) => e.type === "session.event" && e.event.type === "transcript.replace", 20000);
		const last = lastTranscript[lastTranscript.length - 1];
		console.log("after deny, last:", last.role, JSON.stringify(last.content).slice(0, 200));
		const denied = lastTranscript
			.filter((m) => m.role === "toolResult")
			.map((m) => JSON.stringify(m.content).slice(0, 100));
		console.log("tool results:", denied);
		console.log("counts", JSON.stringify(counts));
		await cmd({ type: "sessions.close", sessionId });
		ws.close();
		process.exit(0);
	} catch (e) {
		console.error("SMOKE2 FAILED", e);
		process.exit(1);
	}
};

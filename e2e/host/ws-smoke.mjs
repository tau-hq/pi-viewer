const url = "ws://127.0.0.1:8787/ws";
const ws = new WebSocket(url);
const pending = new Map();
let n = 0;
const counts = {};
let sessionId;
const send = (o) => ws.send(JSON.stringify(o));
const cmd = (command, sid) =>
	new Promise((resolve, reject) => {
		const id = String(++n);
		pending.set(id, { resolve, reject });
		send(sid ? { type: "cmd", id, sessionId: sid, command } : { type: "cmd", id, command });
	});
const waitFor = (pred, ms) =>
	new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error("timeout waiting")), ms);
		waiters.push({
			pred,
			resolve: (v) => {
				clearTimeout(t);
				resolve(v);
			},
		});
	});
const waiters = [];
ws.onmessage = (m) => {
	const env = JSON.parse(m.data);
	if (env.type === "result") {
		const p = pending.get(env.id);
		pending.delete(env.id);
		env.ok ? p.resolve(env.data) : p.reject(new Error(env.error.message));
	} else if (env.type === "session.event") {
		const t = env.event.type;
		counts[t] = (counts[t] ?? 0) + 1;
		if (t !== "block.delta") console.log("EV", env.seq, t, JSON.stringify(env.event).slice(0, 160));
	} else if (env.type === "session.snapshot")
		console.log(
			"SNAPSHOT seq",
			env.seq,
			"messages",
			env.snapshot.messages.length,
			"model",
			env.snapshot.state.model?.id,
			"cwd",
			env.snapshot.state.cwd,
		);
	else console.log("MSG", env.type, JSON.stringify(env).slice(0, 200));
	for (const w of [...waiters])
		if (w.pred(env)) {
			waiters.splice(waiters.indexOf(w), 1);
			w.resolve(env);
		}
};
ws.onopen = async () => {
	try {
		send({ type: "hello", protocolVersion: 1, clientName: "smoke" });
		await waitFor((e) => e.type === "hello", 5000);
		console.log("host.info", JSON.stringify(await cmd({ type: "host.info" })));
		const projects = await cmd({ type: "projects.list" });
		console.log("projects", projects.length);
		const r = await cmd({ type: "sessions.create", cwd: "/srv/pi-tau" });
		sessionId = r.sessionId;
		console.log("created", sessionId);
		send({ type: "subscribe", sessionId });
		await waitFor((e) => e.type === "session.snapshot", 5000);
		console.log(
			"models",
			(await cmd({ type: "getModels" }, sessionId)).map((m) => `${m.provider}/${m.id}`),
		);
		console.log("thinking levels", await cmd({ type: "getThinkingLevels" }, sessionId));
		await cmd({ type: "setName", name: "Tau smoke" }, sessionId);
		await cmd(
			{
				type: "prompt",
				message:
					"Lies package.json mit dem read-Werkzeug und nenne nur den Wert von name. Antworte auf Deutsch in einem Satz.",
			},
			sessionId,
		);
		await waitFor((e) => e.type === "session.event" && e.event.type === "run.settled", 180000);
		await waitFor((e) => e.type === "session.event" && e.event.type === "transcript.replace", 20000);
		console.log("stats", JSON.stringify(await cmd({ type: "getStats" }, sessionId)).slice(0, 300));
		const list = await cmd({ type: "sessions.list" });
		console.log(
			"sessions.list",
			list
				.slice(0, 3)
				.map((s) => `${s.name ?? "-"} | ${s.path.split("/").pop()} | running=${s.running} msgs=${s.messageCount}`),
		);
		const fm = await cmd({ type: "getForkMessages" }, sessionId);
		console.log("fork messages", fm.length);
		const tree = await cmd({ type: "getTree" }, sessionId);
		console.log("tree roots", tree.tree.length, "leaf", tree.leafId);
		console.log("counts", JSON.stringify(counts));
		await cmd({ type: "sessions.close", sessionId });
		console.log("closed");
		ws.close();
		process.exit(0);
	} catch (e) {
		console.error("SMOKE FAILED", e);
		process.exit(1);
	}
};
ws.onerror = (e) => {
	console.error("ws error", e.message);
	process.exit(1);
};

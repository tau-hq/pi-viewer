// Host smoke: provider list, a login flow that is cancelled at the first prompt, JSONL export.
const port = process.env.TAU_PORT ?? "8787";
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
const pending = new Map(); let n = 0; const waiters = [];
const send = (o) => ws.send(JSON.stringify(o));
const cmd = (command) => new Promise((resolve, reject) => { const id = String(++n); pending.set(id, { resolve, reject }); send({ type: "cmd", id, command }); });
const waitFor = (pred, ms) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("timeout")), ms); waiters.push({ pred, resolve: (v) => { clearTimeout(t); resolve(v); } }); });
ws.onmessage = (m) => {
	const env = JSON.parse(m.data);
	if (env.type === "result") { const p = pending.get(env.id); pending.delete(env.id); env.ok ? p.resolve(env.data) : p.reject(new Error(env.error.code + ": " + env.error.message)); }
	else if (env.type.startsWith("auth.")) console.log("AUTH", JSON.stringify(env).replace(/"value":"[^"]*"/g, '"value":"***"').slice(0, 200));
	for (const w of [...waiters]) if (w.pred(env)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(env); }
};
ws.onopen = async () => {
	try {
		send({ type: "hello", protocolVersion: 1 }); await waitFor((e) => e.type === "hello", 5000);
		const t0 = Date.now(); const providers = await cmd({ type: "auth.providers" });
		console.log(`providers: ${providers.length} in ${Date.now() - t0} ms; configured:`, providers.filter((p) => p.status).map((p) => `${p.id}(${p.status.type}${p.status.source ? ":" + p.status.source : ""})`));
		console.log("sample:", providers.slice(0, 4).map((p) => `${p.id}: ${p.methods.map((m) => m.type + "=" + m.label).join("|")}`));
		const target = providers.find((p) => p.id === "vendor") ?? providers.find((p) => p.methods.some((m) => m.type === "api_key"));
		const { flowId } = await cmd({ type: "auth.login", providerId: target.id, method: "api_key" });
		const prompt = await waitFor((e) => e.type === "auth.prompt" && e.flowId === flowId, 10000);
		console.log("first prompt:", prompt.prompt.type, JSON.stringify(prompt.prompt.message).slice(0, 80));
		await cmd({ type: "auth.cancel", flowId });
		const done = await waitFor((e) => e.type === "auth.done" && e.flowId === flowId, 10000);
		console.log("done after cancel:", done.ok, done.error);
		const sessions = await cmd({ type: "sessions.list" });
		if (sessions[0]) { const x = await cmd({ type: "sessions.exportJsonl", sessionPath: sessions[0].path }); console.log("exportJsonl:", x.fileName, x.content.length, "chars, first line type:", JSON.parse(x.content.split("\n")[0]).type); }
		ws.close(); process.exit(0);
	} catch (e) { console.error("AUTH SMOKE FAILED", e); process.exit(1); }
};

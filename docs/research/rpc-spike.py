import json, subprocess, sys, time, threading, queue, os
S=os.environ["S"]
cmd=["/srv/pi/pi-test.sh","--mode","rpc","--model","nebius/zai-org/GLM-5.3-Flash","--no-session"]
p=subprocess.Popen(cmd,cwd="/srv/pi-tau",stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=open(f"{S}/rpc-stderr.log","w"),text=True,bufsize=1)
q=queue.Queue()
def reader():
    for line in p.stdout: q.put(line)
    q.put(None)
threading.Thread(target=reader,daemon=True).start()
log=open(f"{S}/rpc-spike.jsonl","w")
def send(o): p.stdin.write(json.dumps(o)+"\n"); p.stdin.flush()
def pump(until=None,timeout=60):
    t0=time.time(); counts={}
    while time.time()-t0<timeout:
        try: line=q.get(timeout=0.5)
        except queue.Empty: continue
        if line is None: print("EOF"); return counts
        log.write(line)
        try: ev=json.loads(line)
        except Exception: print("nicht-JSON:",line[:100]); continue
        t=ev.get("type"); counts[t]=counts.get(t,0)+1
        if t=="response": print("RESP",ev.get("command"),ev.get("success"),json.dumps(ev.get("data",ev.get("error")))[:220])
        elif t=="message_update":
            e=ev["assistantMessageEvent"]; counts["mu:"+e.get("type","?")]=counts.get("mu:"+e.get("type","?"),0)+1
        elif t in ("message_start","message_end"):
            m=ev.get("message",{}); print(t,m.get("role"),"blocks:",[c.get("type") for c in m.get("content",[])] if isinstance(m.get("content"),list) else type(m.get("content")).__name__,"stop:",m.get("stopReason"),"usage:",json.dumps(m.get("usage"))[:120])
        elif t=="extension_ui_request": print("UI",json.dumps(ev)[:200])
        else: print("EV",t,json.dumps({k:v for k,v in ev.items() if k!="type"})[:160])
        if until and t==until: return counts
    print("TIMEOUT waiting for",until); return counts
send({"id":"1","type":"get_state"}); pump("response",20)
send({"id":"2","type":"get_available_models"}); pump("response",20)
send({"id":"3","type":"get_commands"}); pump("response",20)
send({"id":"4","type":"prompt","message":"Antworte kurz auf Deutsch: Wie heisst die Hauptstadt von Frankreich? Nutze kein Werkzeug."})
c=pump("agent_settled",120); print("Zaehler:",json.dumps(c))
send({"id":"5","type":"prompt","message":"Lies bitte die Datei package.json in diesem Verzeichnis mit dem read-Werkzeug und nenne mir nur den Wert von name."})
c=pump("agent_settled",150); print("Zaehler:",json.dumps(c))
send({"id":"6","type":"get_session_stats"}); pump("response",20)
send({"id":"7","type":"get_entries"}); pump("response",20)
p.stdin.close(); pump(None,10); print("exit",p.wait(10))

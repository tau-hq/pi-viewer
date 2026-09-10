#!/usr/bin/env python3
"""Remove Tau's old bookkeeping entries from pi session files.

Until 2026-09-10 Tau answered its host through `appendEntry`, which wrote a
`custom` entry with a `tau.*` type into the session file on every open. Those
entries are invisible in both pi and Tau, but they sit in the conversation tree
and date the file. This removes them and re-links their children to the nearest
surviving ancestor, so the tree stays intact.

Usage: strip-tau-entries.py <sessions-dir> [--apply]
"""
import json
import sys
from pathlib import Path


def is_tau(entry):
    return entry.get("type") == "custom" and str(entry.get("customType", "")).startswith("tau.")


def process(path: Path, apply: bool):
    raw = path.read_text(encoding="utf-8", errors="replace")
    lines = [line for line in raw.split("\n") if line.strip()]
    entries, parsed = [], True
    for line in lines:
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            parsed = False
            break
    if not parsed:
        return None, "nicht lesbar"

    drop = {e.get("id") for e in entries if is_tau(e)}
    if not drop:
        return 0, None

    # Map every dropped id to the nearest ancestor that survives.
    parent_of = {e.get("id"): e.get("parentId") for e in entries}
    def surviving(pid):
        seen = set()
        while pid in drop and pid not in seen:
            seen.add(pid)
            pid = parent_of.get(pid)
        return pid

    out = []
    for entry in entries:
        if is_tau(entry):
            continue
        if entry.get("parentId") in drop:
            entry["parentId"] = surviving(entry.get("parentId"))
        out.append(entry)

    # Nothing may point at an id that is gone.
    ids = {e.get("id") for e in out}
    for entry in out:
        pid = entry.get("parentId")
        if pid is not None and pid not in ids and "type" in entry and entry.get("type") != "session":
            return None, f"Waise nach dem Umhaengen: {entry.get('id')} -> {pid}"

    if apply:
        tmp = path.with_suffix(".jsonl.tmp")
        tmp.write_text("\n".join(json.dumps(e, ensure_ascii=False, separators=(",", ":")) for e in out) + "\n", encoding="utf-8")
        tmp.replace(path)
    return len(drop), None


def main():
    root = Path(sys.argv[1])
    apply = "--apply" in sys.argv
    total = files = 0
    for path in sorted(root.glob("*/*.jsonl")):
        removed, error = process(path, apply)
        if error:
            print(f"UEBERSPRUNGEN {path.name}: {error}")
            continue
        if removed:
            files += 1
            total += removed
            print(f"{'entfernt' if apply else 'wuerde entfernen'}: {removed:2d} in {path.name}")
    print(f"\n{total} Eintraege in {files} Dateien{'' if apply else ' (Probelauf, nichts geaendert)'}")


if __name__ == "__main__":
    main()

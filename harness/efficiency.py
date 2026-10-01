#!/usr/bin/env python3
"""Per-agent token/context efficiency for one run-all leg log, from Ollama's journal.

usage: POLY_LABEL=<polyglot results label> efficiency.py <run-all log> <dir1:dir2> <model> <start date>

Each agent leg runs alone on the GPU between its "starting" and "done" lines, so every Ollama
request in that window belongs to that leg. Clock times in the log roll over past midnight.
"""
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

log_path, dirs, model, start_day = sys.argv[1:5]
result_dirs = [Path(d) for d in dirs.split(":")]
poly = os.environ.get("POLY_LABEL", "polyglot-cli-final")

state = {"day": datetime.strptime(start_day, "%Y-%m-%d"), "last": None}


def stamp(hms):
    t = datetime.strptime(f"{state['day']:%Y-%m-%d} {hms}", "%Y-%m-%d %H:%M:%S")
    if state["last"] and t < state["last"]:
        state["day"] += timedelta(days=1)
        t += timedelta(days=1)
    state["last"] = t
    return t


legs, starts = [], {}
for line in Path(log_path).read_text().splitlines():
    if m := re.match(r"=== \[([\w-]+)\] .*starting (\d\d:\d\d:\d\d)", line):
        starts[m.group(1)] = stamp(m.group(2))
    elif (m := re.match(r"=== \[([\w-]+)\] done (\d\d:\d\d:\d\d)", line)) and m.group(1) in starts:
        legs.append((m.group(1), starts[m.group(1)], stamp(m.group(2))))

journal = subprocess.run(
    ["journalctl", "-u", "ollama", "--since", f"{legs[0][1]:%Y-%m-%d %H:%M:%S}",
     "--until", f"{legs[-1][2]:%Y-%m-%d %H:%M:%S}", "--no-pager", "-o", "short-iso"],
    capture_output=True, text=True, check=False,
).stdout

tasks = defaultdict(dict)
for line in journal.splitlines():
    ts = re.match(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)", line)
    tid = re.search(r"\| task (\d+) \|", line)
    if not ts or not tid:
        continue
    t = tasks[tid.group(1)]
    if m := re.search(r"new prompt, .*task\.n_tokens = (\d+)", line):
        t["time"] = datetime.strptime(ts.group(1), "%Y-%m-%dT%H:%M:%S")
        t["prompt"] = int(m.group(1))
    elif m := re.search(r"prompt eval time = .*/\s*(\d+) tokens", line):
        t["processed"] = int(m.group(1))
    elif m := re.search(r"\beval time = .*/\s*(\d+) tokens", line):
        t["output"] = int(m.group(1))
    elif m := re.search(r"stop processing: n_tokens = (\d+)", line):
        t["final"] = int(m.group(1))

rows = []
for agent, s, e in legs:
    label = poly if agent == "polyglot-cli" else agent
    path = next((d / f"{label}-{model}.json" for d in result_dirs if (d / f"{label}-{model}.json").exists()), None)
    if path is None:
        continue
    res = json.loads(path.read_text())
    reqs = [t for t in tasks.values() if "time" in t and s <= t["time"] <= e]
    passed = res["totalPass"]

    def per(x, passed=passed):
        return x / passed if passed else float("nan")

    prompts = sorted(r.get("prompt", 0) for r in reqs)
    real = [p for p in prompts if p >= 900]
    rows.append({
        "agent": agent, "pass": f"{passed}/{res['totalTrials']}",
        "first_turn": real[len(real) // 20] if real else 0,
        "side_requests": len(prompts) - len(real),
        "peak_context": max((r.get("final", 0) for r in reqs), default=0),
        "prompt_tok_per_pass": per(sum(r.get("prompt", 0) for r in reqs)),
        "processed_tok_per_pass": per(sum(r.get("processed", 0) for r in reqs)),
        "output_tok_per_pass": per(sum(r.get("output", 0) for r in reqs)),
        "requests_per_pass": per(len(reqs)),
        "seconds_per_pass": per((e - s).total_seconds()),
    })

cols = ["agent", "pass", "first_turn", "side_requests", "peak_context", "prompt_tok_per_pass",
        "processed_tok_per_pass", "output_tok_per_pass", "requests_per_pass", "seconds_per_pass"]
print(" | ".join(cols))
for r in rows:
    print(" | ".join(f"{r[c]:.0f}" if isinstance(r[c], float) else str(r[c]) for c in cols))
print(json.dumps({"model": model, "rows": rows}), file=sys.stderr)

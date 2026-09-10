// Runs pi (@earendil-works/pi-coding-agent) against the benchmark scenarios on a
// local Ollama model, and writes machine-readable + human-readable results.
//
//   node run-pi.mjs <model> [trials]
//
// Requires: pi installed in this dir (`npm install`), Ollama running with <model>
// pulled, and ./pi-home/.pi/agent/{models.json,auth.json} configured (see README).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SCENARIOS } from "./scenarios.mjs";
import { verifyScenario } from "./verify.mjs";

const HERE = import.meta.dirname;
const PI = join(HERE, "node_modules/.bin/pi");
const PI_HOME = join(HERE, "pi-home");
const model = process.argv[2] || "qwen2.5-coder:7b";
const trials = Number(process.argv[3] || 3);
const TIMEOUT_MS = 600_000;
const date = new Date().toISOString().slice(0, 10);
const outDir = join(HERE, "..", "results", date);

function piVersion() {
  try {
    return execFileSync(PI, ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function runOnce(scenario) {
  const dir = mkdtempSync(join(tmpdir(), "bench-pi-"));
  try {
    for (const [rel, content] of Object.entries(scenario.files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content);
    }
    let raw = "";
    let timedOut = false;
    try {
      raw = execFileSync(
        PI,
        ["-p", "--mode", "json", "--no-session", "--no-context-files", "--provider", "ollama", "--model", model, scenario.prompt],
        { cwd: dir, env: { ...process.env, HOME: PI_HOME, PI_OFFLINE: "1" }, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
      );
    } catch (err) {
      raw = (err.stdout || "").toString();
      if (err.signal === "SIGTERM" || err.code === "ETIMEDOUT") timedOut = true;
    }
    const events = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    let toolCalls = 0;
    let finalText = "";
    for (const e of events) {
      if (e.type === "turn_end" && Array.isArray(e.toolResults)) toolCalls += e.toolResults.length;
      if (e.type === "message_end" && e.message?.content)
        finalText = e.message.content.map((c) => c.text || "").join(" ");
    }
    const files = {};
    for (const rel of Object.keys(scenario.files)) {
      try {
        files[rel] = readFileSync(join(dir, rel), "utf8");
      } catch {
        files[rel] = null;
      }
    }
    const completed = scenario.done(files, finalText) && verifyScenario(scenario, dir);
    return { completed, toolCalls, timedOut };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const result = { tool: "pi", toolVersion: piVersion(), model, trials, date, scenarios: [] };
for (const scenario of SCENARIOS) {
  const runs = [];
  for (let t = 0; t < trials; t++) {
    process.stdout.write(`  pi · ${model} · ${scenario.name} trial ${t + 1}... `);
    const r = runOnce(scenario);
    runs.push(r);
    console.log(`${r.completed ? "PASS" : "fail"}  (${r.toolCalls} tool calls${r.timedOut ? ", TIMEOUT" : ""})`);
  }
  result.scenarios.push({
    name: scenario.name,
    pass: runs.filter((r) => r.completed).length,
    trials: runs.length,
    zeroToolCallRuns: runs.filter((r) => r.toolCalls === 0).length,
    runs,
  });
}
result.totalPass = result.scenarios.reduce((a, s) => a + s.pass, 0);
result.totalTrials = result.scenarios.reduce((a, s) => a + s.trials, 0);

mkdirSync(outDir, { recursive: true });
const safe = model.replace(/[^\w.-]/g, "-");
writeFileSync(join(outDir, `pi-${safe}.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(`\npi total: ${result.totalPass}/${result.totalTrials}  →  results/${date}/pi-${safe}.json`);

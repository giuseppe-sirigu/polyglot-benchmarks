// Runs Hermes Agent (NousResearch/hermes-agent) against the benchmark scenarios on
// a local Ollama model.
//
//   node run-hermes.mjs <model> [trials]
//
// Requires: `.venv` with `hermes-agent` installed, Ollama running with <model>
// pulled, and ./hermes-home/.hermes/config.yaml configured (see README):
//   model.provider=custom  model.base_url=http://localhost:11434/v1
//   model.api_mode=chat_completions  model.ollama_num_ctx=65536
//   model.context_length=65536  model.api_key=ollama
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SCENARIOS } from "./scenarios.mjs";
import { verifyScenario } from "./verify.mjs";

const HERE = import.meta.dirname;
const HERMES = join(HERE, ".venv/bin/hermes");
const HERMES_HOME = join(HERE, "hermes-home");
const model = process.argv[2] || "qwen2.5-coder:7b";
const trials = Number(process.argv[3] || 3);
const TIMEOUT_MS = 600_000;
const date = new Date().toISOString().slice(0, 10);
const outDir = join(HERE, "..", "results", date);

function hermesVersion() {
  try {
    return execFileSync(HERMES, ["--version"], { encoding: "utf8" }).split("\n")[0].trim();
  } catch {
    return "unknown";
  }
}

function runOnce(scenario) {
  const dir = mkdtempSync(join(tmpdir(), "bench-hermes-"));
  try {
    for (const [rel, content] of Object.entries(scenario.files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content);
    }
    let out = "";
    let timedOut = false;
    try {
      out = execFileSync(
        HERMES,
        // -t file,terminal: restrict to the read/write/patch/search + shell toolset,
        // roughly matching pi's and Polyglot's toolset, so the comparison is about
        // the loop rather than Hermes's 26-tool default surface.
        ["chat", "-q", scenario.prompt, "--yolo", "-v", "-m", model, "-t", "file,terminal", "--ignore-rules"],
        { cwd: dir, env: { ...process.env, HOME: HERMES_HOME }, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
      );
    } catch (err) {
      out = `${(err.stdout || "").toString()}\n${(err.stderr || "").toString()}`;
      if (err.signal === "SIGTERM" || err.code === "ETIMEDOUT") timedOut = true;
    }
    // "Messages:  N (M user, K tool call(s))" on the session-summary line; also
    // "tool_turns=K" in the verbose turn-end log lines.
    let toolCalls = 0;
    const m1 = out.match(/Messages:\s*\d+\s*\([^)]*?(\d+)\s+tool calls?\)/);
    if (m1) toolCalls = Number(m1[1]);
    const turnMatches = [...out.matchAll(/tool_turns=(\d+)/g)].map((m) => Number(m[1]));
    if (turnMatches.length) toolCalls = Math.max(toolCalls, ...turnMatches);

    const files = {};
    for (const rel of Object.keys(scenario.files)) {
      try {
        files[rel] = readFileSync(join(dir, rel), "utf8");
      } catch {
        files[rel] = null;
      }
    }
    // Verbose stdout is mostly `HH:MM:SS - logger - LEVEL - ...` lines plus a box-drawn
    // response panel. Strip both to recover the assistant's final text (for read-only checks).
    const LOG_LINE = /^\d{2}:\d{2}:\d{2} /;
    const finalText = out
      .split("\n")
      .map((l) => l.replace(/[│╭╰─╮╯]/gu, "").trim())
      .filter((l) => l && !LOG_LINE.test(l) && !/^(session_id:|⚡|🎉|⚕)/.test(l))
      .join(" ");
    const completed = scenario.done(files, finalText) && verifyScenario(scenario, dir);
    return { completed, toolCalls, timedOut };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const result = { tool: "hermes", toolVersion: hermesVersion(), model, trials, date, scenarios: [] };
for (const scenario of SCENARIOS) {
  const runs = [];
  for (let t = 0; t < trials; t++) {
    process.stdout.write(`  hermes · ${model} · ${scenario.name} trial ${t + 1}... `);
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
writeFileSync(join(outDir, `hermes-${safe}.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(`\nhermes total: ${result.totalPass}/${result.totalTrials}  →  results/${date}/hermes-${safe}.json`);

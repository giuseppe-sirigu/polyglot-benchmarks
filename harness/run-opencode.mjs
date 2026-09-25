// Runs opencode (opencode-ai) against the benchmark scenarios on a local Ollama model,
// mirroring run-pi.mjs exactly so results are directly comparable.
//
//   node run-opencode.mjs <model> [trials]
//
// Requires: opencode-ai installed in this dir (`npm install`), Ollama running with
// <model> pulled. Unlike pi (a static models.json in an isolated HOME), opencode reads
// project-local config (opencode.jsonc) from the working directory, so this writes a
// fresh one-model config into each seeded temp dir per run rather than maintaining a
// static list - simpler given each invocation only ever needs the one model under test.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SCENARIOS } from "./scenarios.mjs";
import { verifyScenario } from "./verify.mjs";

const HERE = import.meta.dirname;
const OPENCODE = join(HERE, "node_modules/.bin/opencode");
const OPENCODE_HOME = join(HERE, "opencode-home");
const model = process.argv[2] || "qwen2.5-coder:7b";
const trials = Number(process.argv[3] || 3);
const TIMEOUT_MS = 600_000;
const date = new Date().toISOString().slice(0, 10);
const outDir = join(HERE, "..", "results", date);

function opencodeVersion() {
  try {
    return execFileSync(OPENCODE, ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function writeProjectConfig(dir) {
  // One provider, one model - the exact model under test - per the custom-provider
  // schema (https://opencode.ai/config.json): an OpenAI-compatible provider pointed at
  // the local Ollama endpoint, using the @ai-sdk/openai-compatible package.
  const config = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      ollama: {
        npm: "@ai-sdk/openai-compatible",
        name: "Ollama (local, benchmark harness)",
        options: { baseURL: "http://localhost:11434/v1" },
        models: { [model]: { name: model } },
      },
    },
    model: `ollama/${model}`,
  };
  writeFileSync(join(dir, "opencode.jsonc"), JSON.stringify(config, null, 2));
}

function runOnce(scenario) {
  const dir = mkdtempSync(join(tmpdir(), "bench-opencode-"));
  try {
    for (const [rel, content] of Object.entries(scenario.files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content);
    }
    writeProjectConfig(dir);

    let raw = "";
    let timedOut = false;
    try {
      raw = execFileSync(
        OPENCODE,
        ["run", "--format", "json", scenario.prompt],
        { cwd: dir, env: { ...process.env, HOME: OPENCODE_HOME }, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
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

    // Event parsing verified against two real live runs (2026-09-25) before trusting
    // this, not guessed from docs: a top-level event has {type, timestamp, sessionID,
    // part}. A real, executed tool call is `type === "tool_use"` (part.type === "tool",
    // part.tool === "<name>", part.state.status === "completed") - confirmed on a
    // successful qwen3-coder run (2 tool_use events for a real read then write). A
    // model that emits a tool call as plain text instead of a real invocation (the
    // exact failure mode this whole benchmark exists to measure - confirmed on a
    // qwen2.5-coder:7b run where the model wrote `{"name":"read","arguments":{...}}`
    // as prose) produces a `type === "text"` event instead, correctly not counted here.
    let toolCalls = 0;
    let finalText = "";
    for (const e of events) {
      if (e?.type === "tool_use") toolCalls++;
      if (e?.type === "text" && typeof e?.part?.text === "string" && e.part.text.trim()) {
        finalText = e.part.text;
      }
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
    return { completed, toolCalls, timedOut, rawEventCount: events.length };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const result = { tool: "opencode", toolVersion: opencodeVersion(), model, trials, date, scenarios: [] };
for (const scenario of SCENARIOS) {
  const runs = [];
  for (let t = 0; t < trials; t++) {
    process.stdout.write(`  opencode · ${model} · ${scenario.name} trial ${t + 1}... `);
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
writeFileSync(join(outDir, `opencode-${safe}.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(`\nopencode total: ${result.totalPass}/${result.totalTrials}  →  results/${date}/opencode-${safe}.json`);

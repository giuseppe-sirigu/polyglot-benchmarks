// Runs Polyglot through its public CLI (`polyglot -p`) against the benchmark scenarios on a
// local Ollama model - the same path, tasks and scoring (scenarios.mjs `done` + verify.mjs) as
// every other agent. run-polyglot.sh instead wraps Polyglot's own scenario suite, whose task
// checks are stricter literal matches (e.g. fix-bug requires the exact text `for (let i = 0;`),
// so its numbers are not comparable with the other agents'.
//
//   node run-polyglot-cli.mjs <model> [trials]
//
// Requires: a built Polyglot checkout (POLYGLOT_REPO, default a `polyglot` checkout next to this repo,
// `pnpm build`), Ollama running with <model> pulled. Uses an isolated HOME (polyglot-home/)
// with default settings, so the developer's own ~/.polyglot config never leaks in.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SCENARIOS } from "./scenarios.mjs";
import { verifyScenario } from "./verify.mjs";

const HERE = import.meta.dirname;
const REPO = process.env.POLYGLOT_REPO || join(HERE, "..", "..", "polyglot");
// POLYGLOT_CLI points at a specific build (e.g. an npm-installed release) instead of the repo.
const CLI = process.env.POLYGLOT_CLI || join(REPO, "packages/cli/dist/main.js");
const POLYGLOT_HOME = join(HERE, "polyglot-home");
// Names the results file and log lines, so a build under test (e.g. a fix branch) doesn't overwrite
// the baseline: POLYGLOT_CLI_LABEL=polyglot-cli-fixed POLYGLOT_REPO=../polyglot-fixes ...
const LABEL = process.env.POLYGLOT_CLI_LABEL || "polyglot-cli";
const model = process.argv[2] || "qwen2.5-coder:7b";
const trials = Number(process.argv[3] || 3);
const RUN_SCENARIOS = process.env.SCENARIO_FILTER
  ? SCENARIOS.filter((s) => s.name === process.env.SCENARIO_FILTER)
  : SCENARIOS;
const TIMEOUT_MS = 600_000;
const date = new Date().toISOString().slice(0, 10);
const outDir = join(HERE, "..", "results", date);

// Default settings plus the endpoint - nothing else - so this measures what a new user gets.
mkdirSync(join(POLYGLOT_HOME, ".polyglot"), { recursive: true });
writeFileSync(
  join(POLYGLOT_HOME, ".polyglot", "settings.json"),
  `${JSON.stringify({ provider: "openai-compatible", model, baseURL: "http://localhost:11434/v1", telemetry: false }, null, 2)}\n`,
);

function cliVersion() {
  try {
    return execFileSync("node", [CLI, "--version"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

// Failed runs keep their full session transcript (every message, including the tool calls
// Polyglot rejected), so a failure can be diagnosed without re-running and hoping it recurs.
const transcriptDir = join(outDir, "transcripts");

function runOnce(scenario, trial) {
  const dir = mkdtempSync(join(tmpdir(), "bench-polyglot-"));
  // A fresh HOME per run: sessions are persisted (for the transcript) without runs mixing.
  const runHome = mkdtempSync(join(tmpdir(), "bench-polyglot-home-"));
  mkdirSync(join(runHome, ".polyglot"), { recursive: true });
  copyFileSync(join(POLYGLOT_HOME, ".polyglot", "settings.json"), join(runHome, ".polyglot", "settings.json"));
  try {
    for (const [rel, content] of Object.entries(scenario.files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content);
    }
    let raw = "";
    let timedOut = false;
    try {
      raw = execFileSync(
        "node",
        [CLI, "-p", "--output-format", "json", "--allow-all", scenario.prompt],
        {
          cwd: dir,
          env: { ...process.env, HOME: runHome },
          timeout: TIMEOUT_MS,
          maxBuffer: 64 * 1024 * 1024,
          encoding: "utf8",
        },
      );
    } catch (err) {
      raw = (err.stdout || "").toString();
      const stderr = (err.stderr || "").toString().trim();
      if (stderr) console.error(`\n  [stderr] ${stderr.split("\n").slice(0, 5).join("\n  ")}`);
      if (err.signal === "SIGTERM" || err.code === "ETIMEDOUT") timedOut = true;
    }
    let envelope = {};
    for (const line of raw.split("\n").filter(Boolean).reverse()) {
      try {
        envelope = JSON.parse(line);
        break;
      } catch {}
    }
    const toolCalls = envelope.reliability?.tool_calls ?? 0;
    const finalText = typeof envelope.result === "string" ? envelope.result : "";
    const files = {};
    for (const rel of Object.keys(scenario.files)) {
      try {
        files[rel] = readFileSync(join(dir, rel), "utf8");
      } catch {
        files[rel] = null;
      }
    }
    const completed = scenario.done(files, finalText) && verifyScenario(scenario, dir);
    let transcript = null;
    if (!completed) {
      const sessionsDir = join(runHome, ".polyglot", "sessions");
      const session = (() => {
        try {
          return readdirSync(sessionsDir).find((f) => f.endsWith(".jsonl"));
        } catch {
          return undefined;
        }
      })();
      if (session) {
        mkdirSync(transcriptDir, { recursive: true });
        const safeModel = model.replace(/[^\w.-]/g, "-");
        transcript = `transcripts/${LABEL}-${safeModel}-${scenario.name}-t${trial + 1}.jsonl`;
        copyFileSync(join(sessionsDir, session), join(outDir, transcript));
      }
    }
    return {
      completed,
      toolCalls,
      timedOut,
      repaired: envelope.reliability?.repaired ?? 0,
      inputTokens: envelope.tokens?.input ?? null,
      outputTokens: envelope.tokens?.output ?? null,
      stopReason: envelope.stop_reason ?? null,
      parseErrors: envelope.reliability?.parse_errors ?? 0,
      transcript,
      // The start of the final reply, to tell "answered in prose" from "emitted a call we missed".
      finalTextHead: finalText.slice(0, 600),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(runHome, { recursive: true, force: true });
  }
}

const result = { tool: LABEL, cli: CLI, toolVersion: cliVersion(), model, trials, date, scenarios: [] };
for (const scenario of RUN_SCENARIOS) {
  const runs = [];
  for (let t = 0; t < trials; t++) {
    process.stdout.write(`  ${LABEL} · ${model} · ${scenario.name} trial ${t + 1}... `);
    const r = runOnce(scenario, t);
    runs.push(r);
    console.log(
      `${r.completed ? "PASS" : "fail"}  (${r.toolCalls} tool calls, ${r.repaired} repaired${r.timedOut ? ", TIMEOUT" : ""})`,
    );
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
writeFileSync(join(outDir, `${LABEL}-${safe}.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(
  `\n${LABEL} total: ${result.totalPass}/${result.totalTrials}  →  results/${date}/${LABEL}-${safe}.json`,
);

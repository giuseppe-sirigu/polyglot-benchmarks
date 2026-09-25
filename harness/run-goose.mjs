// Runs Goose (aaif-goose/goose, Linux Foundation Agentic AI Foundation) against the same
// benchmark scenarios pi/Hermes/Polyglot ran, on a local Ollama model. Mirrors run-pi.mjs
// exactly so results are directly comparable.
//
//   node run-goose.mjs <model> [trials]
//   GOOSE_HARNESS_TOOLSHIM=1 GOOSE_HARNESS_TOOLSHIM_MODEL=llama3.2:3b node run-goose.mjs <model> [trials]
//
// Requires: `goose` on PATH (installed via the official install script), Ollama running with
// <model> pulled. The toolshim mode additionally requires GOOSE_HARNESS_TOOLSHIM_MODEL pulled -
// it's the *interpreter* model Goose uses to convert a non-tool-calling model's text into a
// structured call (Goose's own default is mistral-nemo; overridden here to reuse an
// already-pulled model rather than download a new multi-GB one just for this comparison).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SCENARIOS } from "./scenarios.mjs";
import { verifyScenario } from "./verify.mjs";

const GOOSE = "goose";
const model = process.argv[2] || "qwen2.5-coder:7b";
const trials = Number(process.argv[3] || 3);
const RUN_SCENARIOS = process.env.SCENARIO_FILTER
  ? SCENARIOS.filter((s) => s.name === process.env.SCENARIO_FILTER)
  : SCENARIOS;
const TOOLSHIM = process.env.GOOSE_HARNESS_TOOLSHIM === "1";
const TOOLSHIM_MODEL = process.env.GOOSE_HARNESS_TOOLSHIM_MODEL || "llama3.2:3b";
const TIMEOUT_MS = 600_000;
const date = new Date().toISOString().slice(0, 10);
const outDir = join(import.meta.dirname, "..", "results", date);

function gooseVersion() {
  try {
    return execFileSync(GOOSE, ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Counts tool-call attempts in a Goose JSON transcript. Goose's JSON output has no dedicated
 * "toolUse" content type in what we've observed - a model that emits a tool call as plain text
 * (the exact failure mode under test) shows up as an ordinary `type: "text"` assistant message,
 * indistinguishable at the schema level from a real natural-language reply. So "did it look like
 * a tool call" is judged the same way the scenario's own `done()`/`verify` judges success: by
 * whether the files actually changed / the verify command's output is right - not by trying to
 * parse Goose's internal tool-call representation, which this transcript format doesn't expose
 * distinctly enough to count reliably. `toolCalls` below is therefore a best-effort heuristic
 * (message count with JSON-shaped text), not an authoritative count - flagged as such in results.
 */
function heuristicToolCallCount(messages) {
  let count = 0;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const c of m.content || []) {
      // A real, structured tool call (seen once the GOOSE_TOOLSHIM env var is set) - always
      // counted, regardless of whether it errored or succeeded.
      if (c.type === "toolCall" || c.type === "toolRequest") count++;
      // The default (no toolshim) failure mode: the model emits a JSON-shaped tool call as
      // plain text, which Goose never recognizes as a call at all.
      else if (c.type === "text" && /"name"\s*:\s*"/.test(c.text || "")) count++;
    }
  }
  return count;
}

function finalAssistantText(messages) {
  const assistantMsgs = messages.filter((m) => m.role === "assistant");
  const last = assistantMsgs[assistantMsgs.length - 1];
  if (!last) return "";
  return (last.content || []).map((c) => c.text || "").join(" ");
}

function runOnce(scenario) {
  const dir = mkdtempSync(join(tmpdir(), "bench-goose-"));
  try {
    for (const [rel, content] of Object.entries(scenario.files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content);
    }
    let raw = "";
    let timedOut = false;
    try {
      raw = execFileSync(
        GOOSE,
        [
          "run",
          "--text",
          scenario.prompt,
          "--provider",
          "ollama",
          "--model",
          model,
          "--no-session",
          "--output-format",
          "json",
          "--max-turns",
          "10",
        ],
        {
          cwd: dir,
          timeout: TIMEOUT_MS,
          maxBuffer: 64 * 1024 * 1024,
          encoding: "utf8",
          env: TOOLSHIM
            ? { ...process.env, GOOSE_TOOLSHIM: "true", GOOSE_TOOLSHIM_OLLAMA_MODEL: TOOLSHIM_MODEL }
            : process.env,
        },
      );
    } catch (err) {
      raw = (err.stdout || "").toString();
      if (err.signal === "SIGTERM" || err.code === "ETIMEDOUT") timedOut = true;
    }
    // Goose prints the ASCII banner before the JSON blob on stdout - slice from the first `{`.
    const jsonStart = raw.indexOf("{");
    let messages = [];
    if (jsonStart >= 0) {
      try {
        messages = JSON.parse(raw.slice(jsonStart)).messages || [];
      } catch {
        // leave messages empty - counted as a hard failure below
      }
    }
    const toolCalls = heuristicToolCallCount(messages);
    const finalText = finalAssistantText(messages);
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

const result = {
  tool: TOOLSHIM ? "goose-toolshim" : "goose",
  toolVersion: gooseVersion(),
  model,
  toolshimInterpreterModel: TOOLSHIM ? TOOLSHIM_MODEL : null,
  trials,
  date,
  toolCallCountCaveat:
    "toolCalls counts real toolCall/toolRequest content blocks (seen with the toolshim) plus a " +
    "best-effort heuristic for JSON-shaped plain-text tool-call attempts (the default, " +
    "no-toolshim failure mode) - not an authoritative count either way. See run-goose.mjs.",
  scenarios: [],
};
for (const scenario of RUN_SCENARIOS) {
  const runs = [];
  for (let t = 0; t < trials; t++) {
    process.stdout.write(`  goose · ${model} · ${scenario.name} trial ${t + 1}... `);
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
const fileTag = TOOLSHIM ? "goose-toolshim" : "goose";
writeFileSync(join(outDir, `${fileTag}-${safe}.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(`\n${fileTag} total: ${result.totalPass}/${result.totalTrials}  →  results/${date}/${fileTag}-${safe}.json`);

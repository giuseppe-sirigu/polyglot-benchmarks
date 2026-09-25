// Runs opencode (opencode-ai) against the benchmark scenarios on a local Ollama model,
// mirroring run-pi.mjs exactly so results are directly comparable.
//
//   node run-opencode.mjs <model> [trials]
//
// Requires: opencode-ai installed in this dir (`npm install`), Docker, Ollama running
// with <model> pulled. Unlike pi (a static models.json in an isolated HOME), opencode
// reads project-local config (opencode.jsonc) from the working directory, so this writes
// a fresh one-model config into each seeded temp dir per run rather than maintaining a
// static list - simpler given each invocation only ever needs the one model under test.
//
// SANDBOXED - not optional. opencode's default toolset includes an unrestricted `bash`
// tool. Verified live (2026-09-25): with no containment, a qwen2.5-coder:32b run wandered
// out of its scenario temp dir via plain bash commands (git/read/grep against this very
// repo's real path), and separately, an earlier run actually overwrote the real, tracked
// harness/scenarios.mjs on disk via bash - twice - which was the root cause of a confusing
// scenario-scoring bug investigated the same day. opencode's own path-scoped permission
// system (the "external_directory" prompt, auto-rejected without --auto) does NOT cover
// bash commands at all - only read/glob/grep/write/edit calls that pass an explicit path
// argument. So every run goes through Docker: only the scenario's own temp dir is bind-
// mounted, read-write; nothing else on this machine is visible to the container at all,
// regardless of what the model tries via bash. This is kernel-enforced (mount namespace),
// not an application-level permission prompt with gaps like the one that failed here.
//
// Scenario temp dirs are created under SANDBOX_ROOT (~/.polyglot-bench-sandbox), not
// system /tmp - Docker Desktop (this machine runs the VM-backed variant, not a bare Linux
// daemon) only bind-mounts paths from an explicit, user-granted file-sharing allowlist,
// and that allowlist should never be the whole home/Documents tree (a shared *root* lets
// ANY future container mount ANY file under it, not just this one scenario folder). One
// small, otherwise-empty, purpose-built directory outside Documents keeps the blast radius
// of that grant to "a scratch folder with nothing in it" even in the worst case.
// One-time setup this requires on your end: Docker Desktop -> Settings -> Resources ->
// File Sharing -> add ~/.polyglot-bench-sandbox.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { SCENARIOS } from "./scenarios.mjs";
import { verifyScenario } from "./verify.mjs";

const HERE = import.meta.dirname;
const OPENCODE = join(HERE, "node_modules/.bin/opencode");
const OPENCODE_AI_DIR = join(HERE, "node_modules/opencode-ai");
const DOCKER_IMAGE = "node:20-slim";
const SANDBOX_ROOT = join(homedir(), ".polyglot-bench-sandbox");
mkdirSync(SANDBOX_ROOT, { recursive: true });
const model = process.argv[2] || "qwen2.5-coder:7b";
const trials = Number(process.argv[3] || 3);
const RUN_SCENARIOS = process.env.SCENARIO_FILTER
  ? SCENARIOS.filter((s) => s.name === process.env.SCENARIO_FILTER)
  : SCENARIOS;
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
        // host.docker.internal, not localhost - this runs inside a container (Docker
        // Desktop's VM-backed networking; --network host does NOT map "localhost" to the
        // host machine's own Ollama the way it would on a bare Linux Docker daemon).
        // Verified directly: curl to localhost:11434 from inside the container hangs/
        // fails, host.docker.internal:11434 succeeds. Caught this by inspecting
        // rawEventCount (1, an immediate connection-error event) after a suspicious
        // 0-tool-calls-across-every-scenario result - see runOnce()'s error surfacing.
        options: { baseURL: "http://host.docker.internal:11434/v1" },
        models: { [model]: { name: model } },
      },
    },
    model: `ollama/${model}`,
  };
  writeFileSync(join(dir, "opencode.jsonc"), JSON.stringify(config, null, 2));
}

function runContainedOpencode(dir, promptArgs) {
  // Only `dir` (the scenario's own temp dir) is bind-mounted read-write; the opencode
  // install is mounted read-only for the binary. Default (bridge) networking, reaching
  // the host's Ollama via host.docker.internal (see writeProjectConfig) - deliberately
  // NOT --network host, which would share the host's whole network namespace for no
  // benefit now that host.docker.internal works. Nothing else on this machine is visible
  // inside the container - not this repo, not $HOME, nothing - no matter what the model
  // tries via bash. HOME is an ephemeral in-container path (/root), never bound to the
  // host, so opencode's own config/cache/session state vanishes with the container on
  // --rm.
  const containerName = `polyglot-bench-opencode-${randomUUID()}`;
  try {
    return execFileSync(
      "docker",
      [
        "run", "--rm", "--name", containerName,
        "-v", `${dir}:${dir}`,
        "-v", `${OPENCODE_AI_DIR}:/opt/opencode-ai:ro`,
        "-w", dir,
        "-e", "HOME=/root",
        DOCKER_IMAGE,
        "/opt/opencode-ai/bin/opencode.exe", "run", "--format", "json", ...promptArgs,
      ],
      { timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
    );
  } finally {
    // Belt-and-suspenders: if Node's timeout SIGKILLs the docker CLI before the
    // container itself receives the stop signal, --rm never fires. This is a no-op
    // (and harmlessly errors, ignored) when the container already cleaned itself up.
    try {
      execFileSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
    } catch {}
  }
}

function runOnce(scenario) {
  const dir = mkdtempSync(join(SANDBOX_ROOT, "bench-opencode-"));
  try {
    for (const [rel, content] of Object.entries(scenario.files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content);
    }
    writeProjectConfig(dir);

    let raw = "";
    let timedOut = false;
    try {
      raw = runContainedOpencode(dir, [scenario.prompt]);
    } catch (err) {
      raw = (err.stdout || "").toString();
      const stderr = (err.stderr || "").toString().trim();
      if (stderr) console.error(`\n  [stderr] ${stderr.split("\n").slice(0, 5).join("\n  ")}`);
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

    // A connection/infra failure (e.g. couldn't reach Ollama) looks identical to "the
    // model chose to do nothing" if left unchecked - both produce 0 tool calls. Learned
    // this the hard way (2026-09-25): host.docker.internal vs. localhost inside the
    // container broke every single trial silently until this check caught it. Fail loud
    // and abort the whole run rather than silently writing 18 fake zero results - a
    // systemic connectivity problem affects every subsequent trial too.
    const errorEvent = events.find((e) => e?.type === "error");
    if (errorEvent) {
      throw new Error(
        `opencode reported an error event, not a model result: ${JSON.stringify(errorEvent.error ?? errorEvent).slice(0, 300)}`,
      );
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
for (const scenario of RUN_SCENARIOS) {
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

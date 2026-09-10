# Methodology

## What is being measured

A coding agent, given a task, must: read files, run tools, interpret results, edit
files, and stop when done. On an open-weight model this whole chain depends on the
model reliably emitting tool calls in a form the harness can execute. Some models
do this well natively; many don't.

The benchmark measures, per (tool, model, task):

1. **Task completion** — did the final file state / reported answer satisfy the
   task's success check.
2. **Zero-tool-call runs** — how often the agent loop never engaged at all (a
   direct measure of "the model's tool-call format defeated the harness").

## The tasks

Six tasks, in `harness/scenarios.mjs`, transcribed verbatim from Polyglot's own
scenario suite (`packages/core/src/testing/scenarios.ts`) so all tools run
identical work:

| task | shape | tool calls (competent run) |
|---|---|---|
| `add-count-command` | add a switch case to a small CLI | 2 |
| `fix-bug` | find + fix an off-by-one, verify | 4 |
| `read-and-report` | answer a question from a file, no edits | 1–2 |
| `delete-dead-code` | remove an unused export | 2 |
| `rename-across-files` | rename an export + fix its importer, verify | 5–6 |
| `locate-and-fix` | trace a runtime error across files, fix, verify | 5–6 |

Each is seeded into a fresh temp directory per run.

## The tools

| tool | version | tool-call mechanism |
|---|---|---|
| Polyglot | 0.11.0 | free-text `<tool_call>` grammar + streaming repair pipeline |
| pi | 0.85.1 | native function calling (OpenAI `tools` / `tool_calls`) |
| Hermes Agent | *(planned)* | multi-format tool-call parser |

## Models

Local, via Ollama (`http://localhost:11434/v1`), on an RTX 5080 16GB:

- `llama3.2:3b` — weak baseline
- `qwen2.5-coder:7b` — "common first pick"; capable coder, unreliable native FC
- `qwen2.5-coder:14b` — solid
- `qwen3-coder` (30B-A3B) — strong native FC

## Running

- **pi:** `pi -p --mode json --no-session --no-context-files --provider ollama
  --model <m> "<prompt>"` in the seeded temp dir. YOLO tool approval (pi's default
  in `-p`). Isolated `HOME` (`harness/pi-home/`) so the real user config is
  untouched.
- **Polyglot:** its own `pnpm scenario:live` harness, which drives `runAgentTurn`
  with real tools against a real temp dir and records invariants + task completion.

Trials: 2–4 per (tool, model, task); weak models are nondeterministic, so single
runs are noise.

## Scoring

`scenarios.mjs` carries a `done(files, finalText)` predicate per task, tolerant of
formatting (e.g. `rename-across-files` checks the export was renamed *and* the
importer updated *and* no stale reference remains). Polyglot's side uses the
equivalent `taskDone` check from its suite.

"Zero tool calls" for pi = no `turn_end` event carried a non-empty `toolResults`
array across the whole run.

## What this shows — and doesn't

**Shows:** whether a tool's tool-call-extraction path survives a given model's
actual output, end to end, on realistic small tasks.

**Doesn't show:**

- Absolute agent quality. Polyglot's own numbers on 7B (~43%) are not good; the
  finding is comparative.
- Performance on large / long-context / multi-hour tasks.
- pi at its best. pi is tested only against Ollama's OpenAI-compat endpoint (the
  realistic local setup); a different pi provider config or Ollama's native API
  might behave differently. Not chased.
- Hosted models, where every tool does well and native FC is reliable.
- Hermes Agent's tolerant-parsing path — the one most likely to match Polyglot's
  behaviour. **This is the main gap until it's added.**

## Reproducibility notes

- Ollama model versions drift; record `ollama list` output alongside results.
- pi and Polyglot both auto-update; versions are pinned in each result file.
- Raw per-run captures are kept in `results/<date>/` so scoring can be re-derived.

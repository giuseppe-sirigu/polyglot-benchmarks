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

Versions used in the 30-run grid (2026-09-29 to 2026-10-01; each result file records its own):

| tool | version | tool-call mechanism |
|---|---|---|
| Polyglot | 0.13.1 + branch `fix/tool-call-format-coverage` (released as 0.13.2) | free-text `<tool_call>` grammar + streaming repair; also reads native `tool_calls` |
| pi | 0.85.1 | native function calling (OpenAI `tools` / `tool_calls`) |
| goose | 1.52.0 | native function calling |
| goose + toolshim | 1.52.0 | a second local model (llama3.2 3B) turns the main model's text into tool calls |
| Hermes Agent | 0.19.0 | native function calling |
| opencode | 1.18.32 | native function calling (runs in Docker) |

## Models

Local, via Ollama (`http://localhost:11434/v1`), on an RTX 5080 16GB, each as a 32k-context variant:

- `qwen3.8-27b-toolfix` - Qwen3.8 27B (Unsloth GGUF Q4_K_M) with a chat template that passes tools through, 32k context
- `gpt-oss-20b-32k`, `devstral-small-2-24b-32k`, `qwen3-coder-30b-32k` - current models with strong native FC
- `qwen2.5-coder-{7b,14b,32b}-32k` - capable coders that write tool calls as text through Ollama

**Context length.** Ollama defaults to a 4,096-token context and silently truncates anything longer. goose,
Hermes and opencode send 4-8k tokens of system prompt, so at the default they ran on a prompt missing most of
their instructions and the task. Every grid model is a variant with `PARAMETER num_ctx 32768`; `run-all.sh`
refuses a model below 16k and, after each leg, counts "truncating input prompt" warnings in the Ollama log and
marks the leg invalid if there are any. Results before 2026-09-29 predate this and are superseded.

## Running

Every agent runs headless in a fresh seeded temp directory per run, with an isolated `HOME` so no user config
leaks in, and all tools auto-approved:

- **Polyglot:** `polyglot -p --output-format json --allow-all` (`run-polyglot-cli.mjs`)
- **pi:** `pi -p --mode json --no-session --no-context-files --provider ollama --model <m> "<prompt>"`
- **goose, Hermes, opencode:** their headless modes, via `run-goose.mjs`, `run-hermes.mjs`, `run-opencode.mjs`

Trials: 5 per (tool, model, task), so 30 runs per cell; 600 s timeout per run.

## Scoring

`scenarios.mjs` carries a `done(files, finalText)` predicate per task, tolerant of
formatting (e.g. `rename-across-files` checks the export was renamed *and* the
importer updated *and* no stale reference remains), plus a verify command run after the agent finishes.
Every agent, Polyglot included, is scored by the same predicate and command.

Tiers, fixed before the runs: reliable = 26+/30, sometimes = 12-25, fails = under 12. With 30 runs a 95%
interval is wide (28/30 is 79-98%), so the claim is the tier, not the count.

## What this shows — and doesn't

**Shows:** whether a tool's tool-call-extraction path survives a given model's
actual output, end to end, on realistic small tasks.

**Doesn't show:**

- Absolute agent quality. Polyglot's own 12/30 on 7B is not good; the finding is
  comparative.
- Performance on large / long-context / multi-hour tasks.
- pi at its best. pi is tested only against Ollama's OpenAI-compat endpoint (the
  realistic local setup); a different pi provider config or Ollama's native API
  might behave differently. Not chased.
- Hosted models, where every tool does well and native FC is reliable.
- A fresh task set. Polyglot's parser fixes came from these tasks' transcripts; the
  failure formats are general, but other agents got no such tuning.

## Updating the results

Polyglot is our own product, so how its numbers get refreshed matters as much as the numbers.

- **The released build sets the column.** When a grid is published, Polyglot's column comes from the npm
  release that is current at that time (`@usepolyglot/cli@X.Y.Z`, recorded in each result file), run once on
  every model, whatever it scores.
- **No best-of-N.** A build is never re-run to replace a disappointing result, and a new release doesn't
  replace the column just because it scored higher. It replaces it because it's the release users now
  install, and the same holds if it scores lower.
- **Every run stays published.** Earlier builds' results remain in `results/` and are listed in
  [`results/GRID.md`](results/GRID.md), so a reader can see every draw, not just the one in the headline.
- **The other agents are re-run when their versions are.** Refreshing another agent's column means a new
  version of that agent, run once, under the same rules.

The 2026-09-29 grid predates this rule: its Polyglot column is the first of three pre-release builds, and the
choice between them is described in `results/GRID.md`.

## Reproducibility notes

- Ollama model versions drift; record `ollama list` output alongside results.
- pi and Polyglot both auto-update; versions are pinned in each result file.
- Raw per-run captures are kept in `results/<date>/` so scoring can be re-derived.

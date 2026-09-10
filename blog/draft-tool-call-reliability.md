---
title: "Your local coding agent might be doing nothing at all"
description: A head-to-head on open-weight tool-call reliability, and why Polyglot parses tool calls out of text instead of trusting the model to format them.
draft: true
---

> Draft for usepolyglot.dev. Numbers from `polyglot-benchmarks` (2026-09-10 run).
> Not for publication until the Hermes strong-model run is clean and sample sizes
> are larger. The Hermes source-code finding and the qwen2.5-coder:7b numbers are
> solid.

## The setup

You run a coding agent against a local model — say `qwen2.5-coder:7b` on Ollama,
because it's a solid coder and it fits on your GPU. You give it a task. It thinks
for a bit, prints a plausible-looking summary of what it did, and stops.

Except it didn't do anything. No files changed. The agent never called a single
tool.

This isn't a rare failure. It's the default behaviour of a whole class of
open-weight models with a whole class of agent runtimes, and most of the time
nobody notices, because the model's *description* of the work it didn't do reads
fine.

## Why it happens

Agents call tools. On a hosted model like Claude or GPT, the model emits tool
calls through a dedicated channel — structured, unambiguous, easy to execute.
Open-weight models are trained to do the same thing, but the training is thinner
and less consistent, and the smaller the model the more it wobbles.

So `qwen2.5-coder:7b`, asked to edit a file, will often produce this — as ordinary
text, in the middle of its reply:

```json
{
  "name": "edit",
  "arguments": { "path": "math.mjs", "edits": [ ... ] }
}
```

That's the *right intent* in *slightly the wrong place*. A runtime that only looks
at the native tool-call channel sees nothing there, treats the whole reply as a
final answer, and ends the turn. Task over. Zero tools called.

## The benchmark

We ran six small coding tasks — add a CLI subcommand, fix an off-by-one, rename a
function across two files, trace a runtime error to its cause — through three
agents on the same local models:

- **Polyglot**, which describes tools in the prompt and parses tool calls back
  *out of the model's text*, with a repair pass for the malformed ones.
- **pi**, an excellent CLI agent that uses native function calling.
- **Hermes Agent** (Nous Research), which advertises "11 tool-call parsers."

### qwen2.5-coder:7b — capable coder, shaky native tool-calling

| | tasks completed | runs with **zero** tool calls |
|---|---|---|
| **Polyglot** | **≈43%** (26/60) | 0 / 18 |
| **pi** | **0%** (0/18) | **18 / 18** |
| **Hermes Agent** | **0%** (0/18) | **18 / 18** |

pi and Hermes made zero tool calls on every run of every task. Not because the
tasks were hard — because the model never used the channel they were listening on.
Polyglot recognised the text-JSON shape (it has a regression test for exactly this)
and ran the calls. Its ~43% isn't impressive on its own — a 7B model still writes
plenty of broken edits — but the agent *did the work* instead of narrating a
fiction.

The Hermes result surprised us, given the "11 parsers" line. Reading the source:
those parsers convert finished conversations into training data. The live agent
loop uses native function calling, and a helper called `strip_think_blocks`
actively *deletes* text-emitted `<tool_call>` blocks from the model's output as
noise. There's an explicit code comment treating in-context tool-call syntax as
"data — do not re-emit it as a tool call." It's a deliberate design choice, and
it's the opposite of ours.

### qwen3-coder — strong native tool-calling

| | tasks completed |
|---|---|
| **Polyglot** | ~99% |
| **pi** | 89% (16/18) |

When the model's native function calling is solid, both agents are strong. (Even
here, one of pi's two misses was qwen3-coder emitting a tool call as text — the
channel slips occasionally on every model; it's just rare enough not to matter.)
Hermes strong-model numbers pending a cleaner run — its default 26-tool surface is
too heavy for a local model to hold.

### The picture

The difference lives in one specific band: **models good enough to do the work,
but not reliable enough at emitting tool calls.** That band is large and it keeps
being repopulated — every non-flagship open-weight release, every 4-bit quant, every
model you run locally instead of paying for.

## What Polyglot does

Polyglot never assumes the model will format a tool call correctly. It:

1. Teaches the grammar in the system prompt.
2. Parses tool calls out of the streamed text — the taught `<tool_call>` tags, and
   the OpenAI-style `{name, arguments}` blob the model reaches for when it forgets.
3. Repairs the near-misses — trailing commas, single quotes, a fenced code block
   wrapped around the arguments, a tool name that's one character off — and runs
   the call anyway.
4. **Shows you every repair.** A `↺ repaired` marker on the card, the raw model
   output one keypress away, a per-model tally in `/reliability`. A parser fix
   can't quietly paper over a model getting worse.

Same parser, same executor, under every provider — so your agent loop behaves the
same on a flaky local model as it does on Claude.

## Honest caveats

- Small sample sizes on some tasks; weak models are noisy.
- pi and Hermes tested only against Ollama's OpenAI-compatible endpoint — the
  realistic local setup, but not necessarily each tool at its best.
- Hermes strong-model numbers are still pending a clean run.
- On genuinely weak models (3B) nothing saves you — all three agents mostly fail.

Full methodology and raw data: [link to polyglot-benchmarks].

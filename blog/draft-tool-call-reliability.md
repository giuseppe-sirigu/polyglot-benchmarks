---
title: "Your local coding agent might be doing nothing at all"
description: A head-to-head on open-weight tool-call reliability, and why Polyglot parses tool calls out of text instead of trusting the model to format them.
draft: true
---

> Draft for usepolyglot.dev. Numbers from `polyglot-benchmarks` (2026-09-10 run).
> The 7B/14B numbers and the Hermes source finding are solid; the qwen3-coder Hermes
> number is confounded by its runtime design and is reported as such. Want larger
> sample sizes before publishing.

## The setup

You run a coding agent against a local model — say `qwen2.5-coder` on Ollama,
because it's a solid coder and it fits on your GPU. You give it a task. It thinks
for a bit, prints a plausible-looking summary of what it did, and stops.

Except it didn't do anything. No files changed. The agent never called a single
tool.

This isn't a rare failure, and it isn't only the small models. We saw it on the 7B
*and* the 14B. It's the default behaviour of a broad class of open-weight models
with a broad class of agent runtimes, and most of the time nobody notices — because
the model's *description* of the work it didn't do reads just fine.

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

### qwen2.5-coder — capable coder, shaky native tool-calling

Both the 7B and the 14B:

| model | | tasks completed | runs with **zero** tool calls |
|---|---|---|---|
| **7B** | Polyglot | **39%** (7/18) | 0 / 18 |
| | pi | **0%** (0/18) | **18 / 18** |
| | Hermes | **0%** (0/18) | **18 / 18** |
| **14B** | Polyglot | **~79%** | 0 |
| | Hermes | **0%** (0/18) | **18 / 18** |

pi and Hermes made zero tool calls on every run of every task — on *both* models.
Not because the tasks were hard, but because the model never used the channel they
were listening on. The 14B even hallucinated tool names into its text
(`{"name":"skills_list","arguments":{}}`) — still text, still ignored.

Polyglot recognised the text-JSON shape (it has a regression test for exactly this)
and ran the calls. 39% on the 7B isn't impressive on its own — a 7B still writes
plenty of broken edits — but the agent *did the work* instead of narrating a
fiction, and on the 14B it's up near 80%.

The Hermes result surprised us, given the "11 tool-call parsers" line. Reading the
`hermes-agent` source: those parsers live at the *model-training and serving* layer
(the `hermes-function-calling` datasets, and a vLLM-side parser for Hermes-format
models) — not in the agent runtime. The runtime's live loop reads the native
`tool_calls` field only. A helper called `strip_think_blocks` actively *deletes*
text-emitted `<tool_call>` blocks from the model's output as noise, and there's an
explicit code comment treating in-context tool-call syntax as "data — do not
re-emit it as a tool call." So Hermes is genuinely strong for a Nous model behind a
Nous endpoint; point it at your own local Qwen and it behaves like pi. It's a
deliberate design choice, and it's the opposite of ours.

### qwen3-coder (30B) — strong native tool-calling

| | tasks completed |
|---|---|
| **Polyglot** | ~99% |
| **pi** | 89% (16/18) |

When the model's native function calling is solid, pi and Polyglot are both strong.
(Even here, one of pi's misses was qwen3-coder emitting a tool call as text — the
channel slips occasionally on every model; it's just rare enough not to matter.)

Hermes scored 1/18 here, but that number is confounded: its restricted toolset
carries a background-process manager and a search tool whose argument shapes trip
the model, and its default 26-tool surface times a local model out completely. It's
a persistent-assistant platform, not a focused coding agent — so we're not reporting
that as a clean parsing result.

### The picture

The gap lives in one band: **models good enough to do the work, but not reliable
enough at emitting tool calls through the local server.** That's not a fringe —
it's the 7B *and* the 14B, and it keeps being repopulated: every non-flagship
open-weight release, every 4-bit quant, every model you run yourself instead of
paying per token.

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

- Small sample sizes (3 trials/scenario); weak models are noisy.
- pi and Hermes tested only against Ollama's OpenAI-compatible endpoint — the
  realistic local setup, but not necessarily each tool at its absolute best.
- Hermes's qwen3-coder number is confounded by its runtime design, not just parsing
  — we've flagged it rather than lead with it.
- On a genuinely weak model (3B) nothing saves you — all three agents mostly fail.
- Polyglot's 7B number (39%) is comparative, not a claim that it makes a 7B good.

Full methodology and raw data: [link to polyglot-benchmarks].

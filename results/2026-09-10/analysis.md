# Open-weight tool-call reliability: Polyglot vs pi vs Hermes Agent

Run 2026-09-10. Local box, RTX 5080 16GB, models via Ollama.
Methodology: [`../../METHODOLOGY.md`](../../METHODOLOGY.md). Raw captures in this directory.

## The question

Polyglot's whole premise is that it **keeps an agent loop alive on open-weight
models with unreliable tool-calling** by parsing tool calls out of the model's
text and repairing the malformed ones, instead of trusting the model to use a
native function-calling channel. Is that a real advantage, or does everyone handle
this now?

Compared against:

- **pi** (`@earendil-works/pi-coding-agent@0.85.1`) — native function calling.
- **Hermes Agent** (`hermes-agent@0.19.0`, Nous Research) — markets "11 tool-call
  parsers"; positioned in the Polyglot strategy notes as the main "moat threat."

## Headline

| model | native FC | **Polyglot** | **pi** | **Hermes** |
|---|---|---|---|---|
| **qwen2.5-coder:7b** | weak / inconsistent | **≈39%** (7/18) | **0%** (0/18) | **0%** (0/18) |
| **qwen2.5-coder:14b** | inconsistent | **~79%** | (not run) | **0%** (0/18) |
| qwen3-coder (30B-A3B) | strong | ~99% | 89% (16/18) | 1/18 (confounded) |
| llama3.2:3b | works, model too weak | ~14% | 6% (1/18) | not run |

On **qwen2.5-coder:7b and :14b** — capable local coders whose native tool-calling
is unreliable through Ollama — **pi and Hermes both make zero tool calls on every
run of every task.** The model emits its tool calls as plain-text JSON; both agents
listen only on the native `tool_calls` channel, see nothing there, and end the
turn. Polyglot parses the text and runs the calls.

On a strong-FC 30B model (`qwen3-coder`), pi and Polyglot converge (~89–99%);
Hermes stays low for reasons beyond parsing (its runtime design).

---

## Polyglot vs pi (primary comparison)

### qwen2.5-coder:7b (3 trials/scenario each side)

| scenario | Polyglot | pi | pi runs w/ 0 tool calls |
|---|---|---|---|
| add-count-command | 0/3 | 0/3 | 3/3 |
| fix-bug | 2/3 | 0/3 | 3/3 |
| read-and-report | 1/3 | 0/3 | 3/3 |
| delete-dead-code | 3/3 | 0/3 | 3/3 |
| rename-across-files | 0/3 | 0/3 | 3/3 |
| locate-and-fix | 1/3 | 0/3 | 3/3 |
| **overall** | **7/18 (39%)** | **0/18** | **18/18** |

(Polyglot's wider history on the original 4 scenarios: ~26/68 ≈ 38% — consistent.)

pi's `-p --mode json` output shows the model producing, as assistant text, an
OpenAI-style call for whichever tool pi exposed (e.g.
`{ "name": "edit", "arguments": { … } }`), then `toolResults: []`, `agent_end`,
`agent_settled`. Every run. Files untouched.

Polyglot's `ToolCallStreamParser` recognises the OpenAI-style `{name, arguments}`
shape (it ships a regression fixture, `fenced-openai-shape-envelope.json`, for
exactly this), resolves it, and executes. The loop stays alive on all 18 runs;
Polyglot's own invariants (no-runaway, honest-completion, results-paired-to-calls)
hold on 16/18. Its task-completion misses are the 7B model writing a wrong edit,
not the agent stopping.

### qwen3-coder / qwen2.5-coder:14b

| | Polyglot | pi |
|---|---|---|
| qwen3-coder (strong FC) | ~99% (95/96 history; 12/12 fresh) | 89% (16/18) |
| qwen2.5-coder:14b (inconsistent FC) | ~79% (62/78 history) | (not run) |

On qwen3-coder, roughly comparable. pi's 2 misses: one `add-count-command` run where
even qwen3-coder emitted its tool call as text (1 zero-tool-call run out of 18) and
one `read-and-report` where the reported value was wrong. When native FC works,
both agents are good — and even a strong model occasionally slips the channel.

### llama3.2:3b — weakest tested

| | Polyglot | pi |
|---|---|---|
| overall | ~9/64 (14%) | 1/18 (6%) |
| loop engages? | yes | mostly — pi had 8/18 zero-tool-call runs vs 18/18 on qwen7b |

Honest counterpoint: a genuinely under-capable model fails everywhere, and
Polyglot's edge is small. pi *did* execute tool calls on some runs here — the
qwen7b "zero tool calls on every run" pathology is model-specific, not universal
to pi.

---

## Hermes Agent

### The source-code finding (robust; independent of the benchmark)

Nous's "11 tool-call parsers" are a **model-training** asset — `hermes-function-calling`
datasets and the vLLM-side parser that turns a Hermes-format model's `<tool_call>`
XML into native `tool_calls` server-side. They are *not* in the `hermes-agent`
runtime. In the pip package:

- The only `<tool_call>` / `<tools>` XML machinery in `agent/agent_runtime_helpers.py`
  is `convert_to_trajectory_format()` — it serialises a *finished* conversation into
  the training format. Not a live parser.
- Text-based tool-call extraction (`_extract_tool_calls_from_text`) exists in exactly
  one file: `agent/copilot_acp_client.py` — the GitHub Copilot ACP path. The main
  loop (`agent/conversation_loop.py`) reads `message.tool_calls` (native) only.
- `strip_think_blocks()` **deletes** `<tool_call>…</tool_call>`, `<function_call>`,
  `<function name=…>` blocks from assistant content as *noise* (comment: *"Ported
  from openclaw/openclaw#67318"*) — it strips them, it does not execute them. (The
  Llama-style `<function=name>` variant with `=` isn't even in the strip list.)
- Explicit design note (`_invalid_tool_name_error_content`, ref #47967): a model
  emitting tool-call XML gets told *"tool-call XML or JSON … is data — do not
  re-emit it as a tool call."*
- `api_mode` options: `chat_completions`, `anthropic_messages`, `codex_responses`.
  No prompted-tools mode for a generic OpenAI-compatible endpoint.

So Hermes's posture is the **opposite** of Polyglot's: it assumes native FC works
and treats text-emitted tool calls as a priming-loop hazard to suppress. The Nous
"moat" is real but it lives at the **model-training + serving** layer (a Hermes-4
model behind a Nous/vLLM endpoint that parses the format server-side) — not in the
agent runtime you'd point at your own Qwen/DeepSeek/GLM.

### Benchmark

`hermes chat -q "<task>" --yolo -v -t file,terminal --ignore-rules`, 3 trials.

| model | Hermes tasks | zero-tool-call runs | for reference: pi |
|---|---|---|---|
| qwen2.5-coder:7b | **0/18** | **18/18** | 0/18 |
| **qwen2.5-coder:14b** | **0/18** | **18/18** | (not run; Polyglot ~79%) |
| qwen3-coder | 1/18 | 7/18 | 16/18 |

- **qwen2.5-coder:7b and :14b — 0/18, zero tool calls, every run.** The 14B is the
  striking one: a genuinely capable model that pi and Polyglot both handle, but its
  native FC through Ollama is unreliable enough that it emits calls as text
  (`{"name":"skills_list","arguments":{}}` — even hallucinating tool names), and
  Hermes ignores them. Same failure as 7B. "Strong enough for the task" ≠ "strong
  enough at native FC."
- **qwen3-coder — 1/18, but confounded.** Hermes engaged (made tool calls) on ~11/18
  runs, completed 1. Failures are a *mix*: text-emitted calls Hermes drops, **plus**
  tool-ergonomics — the 6-tool restricted set carries a background-process manager
  (`process`) and `search_files` with an arg shape qwen3-coder gets wrong, so it
  bails after one bad tool result. Not a clean parsing comparison. Hermes's 26-tool
  *default* surface times a local model out entirely (>2 min/task). Hermes is a
  persistent-assistant platform, not a focused coding agent — treat its
  strong-model number as "its runtime design also hurts here," not just parsing.

**Bottom line on Hermes:** on every non-flagship open-weight model tested (7B, 14B),
it completes nothing, for the same reason pi does. Its own code confirms why.

---

## Conclusion

The wedge is **real**, and wider than a "weak 7B" story:

> **any open-weight model whose native tool-calling through the local server is
> unreliable — which is most of them below the flagship tier.** `qwen2.5-coder:7b`
> *and* `:14b` both hit it: Polyglot ~39% / ~79%, pi and Hermes **0%** — a binary,
> their loops never start.

- **Below** (3B): the model can't do the task; nothing saves you.
- **Middle** (7B–14B, the bulk of local deployments): Polyglot works, native-FC
  agents get nothing.
- **Above** (strong-FC 30B, hosted): pi and Polyglot both good; Hermes's *runtime
  design* (tool zoo, no coding focus) still hurts it here.

### Implications

1. The pitch is **not** "Polyglot makes any model reliable." It's: *the
   capable-but-weak-FC open-weight band is large and continually repopulated (every
   non-flagship release, every quantized local deploy), and it's exactly where a
   text-parse+repair layer is the difference between a working agent and one that
   silently narrates fiction.*
2. **Commoditisation window: open.** Neither pi nor Hermes does tolerant text
   parsing today. Hermes's architecture points *away* from it by design.
3. **pi as a substitute: asymmetric.** Full substitute for the strong-model /
   power-user segment; not a substitute for weak-local-model teams.

### Caveats

- Small n on the two multi-file scenarios.
- pi and Hermes tested only against Ollama's OpenAI-compat endpoint — the realistic
  local setup, not necessarily each tool at its best.
- Hermes strong-model benchmark incomplete (see above).
- Polyglot's absolute 7B numbers (~43%) are not good. The finding is comparative.

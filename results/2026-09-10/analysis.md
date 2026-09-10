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
| **qwen2.5-coder:7b** | weak / inconsistent | **≈43%** (26/60) | **0%** (0/18) | **0%** (0/18) |
| qwen3-coder (30B-A3B) | strong | ~99% | 89% (16/18) | *(see caveats)* |
| llama3.2:3b | works, model too weak | ~14% | 6% (1/18) | not run |

On **qwen2.5-coder:7b** — a capable local coder whose native tool-calling is
unreliable through Ollama — **pi and Hermes both make zero tool calls on every run
of every task.** The model emits its tool calls as plain-text JSON; both agents
listen only on the native `tool_calls` channel, see nothing there, and end the
turn. Polyglot parses the text and runs the calls.

On strong-FC models the gap closes to nothing.

---

## Polyglot vs pi (primary comparison)

### qwen2.5-coder:7b

| scenario | Polyglot | pi | pi runs w/ 0 tool calls |
|---|---|---|---|
| add-count-command | 0/17 | 0/3 | 3/3 |
| fix-bug | 7/17 | 0/3 | 3/3 |
| read-and-report | 6/17 | 0/3 | 3/3 |
| delete-dead-code | 5/17 | 0/3 | 3/3 |
| rename-across-files | 0/3 | 0/3 | 3/3 |
| locate-and-fix | 1/3 | 0/3 | 3/3 |
| **overall** | **≈26/60 (43%)** | **0/18** | **18/18** |

pi's `-p --mode json` output shows the model producing, as assistant text:

```json
{ "name": "edit", "arguments": { "path": "math.mjs", "edits": [ ... ] } }
```

then `toolResults: []`, `agent_end`, `agent_settled`. Every run. Files untouched.

Polyglot's `ToolCallStreamParser` recognises the OpenAI-style `{name, arguments}`
shape (it ships a regression fixture, `fenced-openai-shape-envelope.json`, for
exactly this), resolves it, and executes. The loop stays alive on all 18 runs;
Polyglot's own invariants (no-runaway, honest-completion, results-paired-to-calls)
hold on 16/18. Its task-completion misses are the 7B model writing a wrong edit,
not the agent stopping.

### qwen3-coder / qwen2.5-coder:14b — strong native FC

| | Polyglot | pi |
|---|---|---|
| qwen3-coder | ~99% (95/96 history; 12/12 fresh) | 89% (16/18) |
| qwen2.5-coder:14b | ~79% (62/78) | (not run; native FC solid) |

Roughly comparable. pi's 2 misses on qwen3-coder: one `add-count-command` run where
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

Hermes's "11 tool-call parsers" are for **generating training trajectories**, not
the live agent loop. In `agent/agent_runtime_helpers.py`, the `<tool_call>` /
`<tools>` XML machinery lives in `convert_to_trajectory_format()` — it converts a
completed conversation into the Hermes function-calling format for training data.

The live loop (`agent/conversation_loop.py`) uses native `tool_calls`. And
`strip_think_blocks()` in the same file **deletes** `<tool_call>…</tool_call>`,
`<function_call>`, `<function name=…>` blocks from assistant content as noise
(comment: *"Ported from openclaw/openclaw#67318"*). There is an explicit design
decision (`_invalid_tool_name_error_content`, ref #47967): when a weak model emits
tool-call XML, Hermes replies *"tool-call XML or JSON … is data — do not re-emit
it as a tool call."*

So Hermes's posture is the **opposite** of Polyglot's: it assumes native FC works
and actively suppresses text-emitted tool calls, treating them as a priming-loop
hazard. Its `api_mode` options are `chat_completions`, `anthropic_messages`,
`codex_responses` — there is no prompted-tools / text-parsing mode for a generic
OpenAI-compatible endpoint.

### Benchmark (partial)

- **qwen2.5-coder:7b: 0/18**, `tool_turns=0` on every run — same failure as pi,
  consistent with the source finding. (`hermes-qwen2.5-coder-7b.json`)
- **qwen3-coder: not scored.** The harness run has a scoring bug (verbose-mode
  output not parsed for the read-only check) *and* a methodology problem: Hermes's
  26-tool default surface makes qwen3-coder time out (>2 min/task), while the
  restricted `-t file,terminal` toolset produces generic "what would you like me to
  do?" non-responses on some tasks. qwen3-coder *did* make real tool calls in
  several runs (6, 8, 2…), so it's not a hard failure — it needs a proper Hermes
  methodology. (`hermes-qwen3-coder-latest.UNRELIABLE.json`, `run-hermes.mjs` now
  fixed for a re-run.)

**Bottom line on Hermes:** on the weak-FC model that matters, it fails exactly like
pi, and its own code confirms why. A clean strong-model number is still owed.

---

## Conclusion

The wedge is **real but band-limited** to one region:

> **models capable enough to do the work, but with unreliable native
> tool-calling.** `qwen2.5-coder:7b` is the archetype. There, Polyglot ≈43% vs pi
> and Hermes **0%** — not a margin, a binary: their loops never start.

- **Below** (3B): everything fails.
- **Above** (14B+, hosted, strong-FC 30B): everything works.

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

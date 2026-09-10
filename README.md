# Polyglot benchmarks

Reproducible benchmarks for the thing Polyglot is built to do: **keep an agent loop
alive on open-weight models with unreliable tool-calling.**

The first benchmark is a head-to-head: the same coding tasks, the same local models,
run through [Polyglot](https://usepolyglot.dev), [pi](https://github.com/earendil-works/pi),
and (planned) [Hermes Agent](https://github.com/NousResearch/hermes-agent).

## Headline result (2026-09-10)

On **qwen2.5-coder:7b** — a capable local coder whose native function-calling is
unreliable through Ollama:

| | task completion | runs where the agent made **zero tool calls** |
|---|---|---|
| **Polyglot** (text-parse + repair) | **≈43%** | 0 / 18 |
| **pi** (native function calling) | **0%** | **18 / 18** |
| **Hermes Agent** (native FC; "11 parsers" is a training feature) | **0%** | **18 / 18** |

pi's and Hermes's agent loops never start: the model emits its tool calls as
plain-text JSON instead of through the native `tool_calls` channel, both agents
treat the reply as a final answer, and nothing happens. Polyglot's parser
recognises the shape and runs the call. (Hermes's code actively *strips*
text-emitted tool calls as noise — see the analysis.)

On strong-FC models (`qwen3-coder`, 14B, hosted) the tools converge — the
difference is entirely in the capable-model / weak-FC band.

Full numbers and caveats: [`results/2026-09-10/analysis.md`](results/2026-09-10/analysis.md).

## Layout

```
harness/
  scenarios.mjs        the 6 tasks (self-contained; a transcription of Polyglot's
                       own scenario suite so every tool runs the same thing)
  verify.mjs           runs each task's "verify" command after the agent finishes
  run-pi.mjs           → results/<date>/pi-<model>.json
  run-hermes.mjs       → results/<date>/hermes-<model>.json
  run-polyglot.sh      wraps Polyglot's `pnpm scenario:live`
  pi-home/             isolated pi config pointing at local Ollama
  hermes-home/         isolated Hermes config pointing at local Ollama
results/<date>/        raw captures + analysis
blog/                  draft write-ups for usepolyglot.dev
```

## Reproduce

```bash
# 1. Local models via Ollama
ollama pull qwen2.5-coder:7b qwen3-coder llama3.2:3b

# 2. pi side
cd harness && npm install
node run-pi.mjs qwen2.5-coder:7b 3

# 3. Polyglot side (needs a checkout of the polyglot repo)
POLYGLOT_REPO=~/path/to/polyglot ./run-polyglot.sh qwen2.5-coder:7b 3

# 4. Hermes side
python3 -m venv .venv && .venv/bin/pip install hermes-agent
#   config already in harness/hermes-home/.hermes/config.yaml
node run-hermes.mjs qwen2.5-coder:7b 3
```

See [`METHODOLOGY.md`](METHODOLOGY.md) for scoring, setup details, and what this
does and doesn't show.

## Status

Private working repo. Toward a write-up on usepolyglot.dev. Still owed before
publishing: a clean Hermes strong-model run (harness fixed, methodology needs
work — its 26-tool default times out, restricted toolset degrades responses), and
larger sample sizes on the multi-file scenarios.

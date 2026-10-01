# Polyglot benchmarks

Reproducible benchmarks for the thing Polyglot is built to do: **keep an agent loop
alive on open-weight models with unreliable tool-calling.**

The benchmark is a head-to-head: the same six coding tasks, the same local models, run through
[Polyglot](https://usepolyglot.dev), [pi](https://github.com/earendil-works/pi),
[goose](https://github.com/block/goose) (with and without its toolshim),
[Hermes Agent](https://github.com/NousResearch/hermes-agent) and [opencode](https://opencode.ai).

## Headline result (30-run grid, 2026-09-29 to 2026-10-01)

Thirty runs per agent per model, on seven local models through Ollama with a 32k context. Tiers fixed in
advance: reliable = 26+/30, sometimes = 12-25, fails = under 12.

| Model | Polyglot | pi | goose | goose toolshim | Hermes | opencode |
|---|---|---|---|---|---|---|
| Qwen3.8-27B | 27 | 28 | 30 | 27 | 28 | 30 |
| gpt-oss 20B | 30 | 29 | 18 | 5 | 18 | 15 |
| Devstral Small 2 24B | 29 | 28 | 24 | 18 | 30 | 23 |
| qwen3-coder 30B | 30 | 26 | 29 | 25 | 29 | 23 |
| qwen2.5-coder 32B | 24 | 0 | 0 | 28 | 0 | 0 |
| qwen2.5-coder 14B | 27 | 0 | 0 | 21 | 0 | 0 |
| qwen2.5-coder 7B | 12 | 0 | 0 | 4 | 0 | 0 |

Polyglot is the only agent at "sometimes" or better on all seven. On the newest models every agent works; the
difference is the models that write tool calls as text. Within a tier, a run or two is noise.

Grid, file map, Polyglot re-runs on later builds, and how to reproduce the efficiency numbers:
[`results/GRID.md`](results/GRID.md). Earlier runs before 2026-09-29 used Ollama's default 4,096-token context,
which silently truncated the larger agents' prompts; they are kept for the record but superseded.

## Layout

```
harness/
  scenarios.mjs          the 6 tasks (self-contained; a transcription of Polyglot's
                         own scenario suite so every tool runs the same thing)
  verify.mjs             runs each task's "verify" command after the agent finishes
  run-all.sh             one model through every agent; refuses num_ctx < 16k and
                         checks the Ollama log for truncated prompts
  run-polyglot-cli.mjs   → results/<date>/polyglot-cli-<model>.json (the CLI, same checks)
  run-pi.mjs, run-goose.mjs, run-hermes.mjs, run-opencode.mjs (opencode runs in Docker)
  efficiency.py          per-agent token and context use from the Ollama server log
  pi-home/, hermes-home/ isolated agent configs pointing at local Ollama
results/<date>/          raw captures; failed-run transcripts in transcripts/
results/GRID.md          the 30-run grid and its file map
blog/                    draft write-ups for usepolyglot.dev
```

## Reproduce

```bash
# 1. A 32k-context variant of each model (Ollama defaults to 4,096, which truncates)
printf 'FROM qwen2.5-coder:7b\nPARAMETER num_ctx 32768\n' > Modelfile
ollama create qwen2.5-coder-7b-32k -f Modelfile

# 2. Every agent on one model, 5 trials per task (opencode needs Docker; set DOCKER_CONTEXT if not default)
cd harness && npm install
./run-all.sh qwen2.5-coder-7b-32k 5

# 3. Polyglot from a local build instead of the published CLI
POLYGLOT_CLI=~/path/to/polyglot/packages/cli/dist/main.js POLYGLOT_CLI_LABEL=polyglot-cli-local \
  ./run-all.sh qwen2.5-coder-7b-32k 5
```

`SKIP=pi,goose,...` leaves agents out; `SKIP=polyglot` drops the older scenario-runner leg, which the grid does not use. Hermes needs `python3 -m venv .venv && .venv/bin/pip install hermes-agent`.

See [`METHODOLOGY.md`](METHODOLOGY.md) for scoring, setup details, and what this
does and doesn't show.

## Status

Private working repo, toward publication on usepolyglot.dev. The 30-run grid is the current result.

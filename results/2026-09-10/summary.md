# Summary — 2026-09-10

Task completion (passed / trials). Polyglot via `pnpm scenario:live` (own
`taskDone`); pi & Hermes via `harness/run-*.mjs` (`done` + `verify` command).
3 trials/scenario unless noted.

| model | native FC | Polyglot | pi | Hermes |
|---|---|---|---|---|
| qwen2.5-coder:7b | weak | **7/18 (39%)** | **0/18** | **0/18** |
| qwen2.5-coder:14b | inconsistent | ~79% (history) | not run | **0/18** |
| qwen3-coder:latest | strong | ~99% | 16/18 (89%) | 1/18 ‡ |
| llama3.2:3b | model too weak | ~14% (history) | 1/18 (6%) | not run |

‡ Hermes qwen3-coder confounded — it engaged on ~11/18 runs but its restricted
  toolset's ergonomics (background `process` manager, `search_files` arg shape) trip
  the model; not a clean parsing comparison. Its 26-tool default times a local model
  out entirely. See `analysis.md`.

## Zero-tool-call runs (agent loop never engaged)

| model | pi | Hermes |
|---|---|---|
| qwen2.5-coder:7b | **18/18** | **18/18** |
| qwen2.5-coder:14b | not run | **18/18** |
| qwen3-coder:latest | 1/18 | 7/18 |
| llama3.2:3b | 8/18 | not run |

Polyglot: **0** zero-tool-call runs on any model — it always parses something out of
the text and stays in the loop.

## Takeaway

On `qwen2.5-coder:7b` **and `:14b`** — capable coders whose native tool-calling
through Ollama is unreliable — pi and Hermes complete **nothing**, because their
loops never start (the model emits tool calls as text, native-FC-only agents ignore
them). Polyglot completes 39% / ~79% by parsing the calls out of the text. On a
strong-FC 30B model, pi and Polyglot converge; Hermes still struggles for reasons
beyond parsing.

Hermes's "11 tool-call parsers" are a model-training / vLLM-serving asset, not part
of the `hermes-agent` runtime — its live loop reads native `tool_calls` only and
strips text-emitted calls as noise (source cites in `analysis.md`).

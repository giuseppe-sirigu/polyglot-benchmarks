# Summary — 2026-09-10

Task completion (tasks passed / trials). Polyglot via `pnpm scenario:live` (own
`taskDone`); pi & Hermes via `harness/run-*.mjs` (`done` + `verify` command).

| model | Polyglot | pi | Hermes |
|---|---|---|---|
| qwen2.5-coder:7b | 7/18 (39%)† | **0/18** | **0/18** |
| qwen3-coder:latest | 12/12 fresh · ~95/96 history | 16/18 (89%) | n/a‡ |
| qwen2.5-coder:14b | ~62/78 (79%) history | not run | not run |
| llama3.2:3b | ~9/64 (14%) history | 1/18 (6%) | not run |

† Polyglot qwen7b: 3 fresh `scenario:live` runs — add-count 0/3, fix-bug 2/3,
  read-and-report 1/3, delete-dead-code 3/3, rename-across-files 0/3, locate-and-fix 1/3.
‡ Hermes qwen3-coder run discarded — harness scoring bug + methodology issues
  (see `analysis.md`, `hermes-qwen3-coder-latest.UNRELIABLE.json`).

## Zero-tool-call runs (agent loop never engaged)

| model | pi | Hermes |
|---|---|---|
| qwen2.5-coder:7b | **18/18** | **18/18** |
| qwen3-coder:latest | 1/18 | n/a |
| llama3.2:3b | 8/18 | n/a |

Polyglot: 0 zero-tool-call runs on any model (it always parses something out of the
text and stays in the loop).

## One-line takeaway

On `qwen2.5-coder:7b` — capable coder, unreliable native tool-calling — pi and
Hermes complete **nothing** because their loops never start; Polyglot completes
~39% because it parses the tool calls out of the model's text. On strong-FC models
the tools converge.

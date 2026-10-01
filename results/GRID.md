# 30-run grid (2026-09-29 to 2026-10-01)

Every cell is 30 runs: the 6 tasks in `harness/scenarios.mjs`, 5 trials each, through one agent on one local
model, Ollama with a 32k context (`num_ctx 32768`; `run-all.sh` refuses less than 16k and checks the server log for
truncation). Scored by the same file-state check and verify command for every agent.

Tiers were fixed before the runs: **reliable** = 26+/30, **sometimes** = 12-25, **fails** = under 12. With 30 runs
the 95% range is wide (28/30 is 79-98%), so cells within a tier are not ranked.

| Model | Polyglot | pi | goose | goose toolshim | Hermes | opencode |
|---|---|---|---|---|---|---|
| Qwen3.8-27B | 27 (reliable) | 28 (reliable) | 30 (reliable) | 27 (reliable) | 28 (reliable) | 30 (reliable) |
| gpt-oss 20B | 30 (reliable) | 29 (reliable) | 18 (sometimes) | 5 (fails) | 18 (sometimes) | 15 (sometimes) |
| Devstral Small 2 24B | 29 (reliable) | 28 (reliable) | 24 (sometimes) | 18 (sometimes) | 30 (reliable) | 23 (sometimes) |
| qwen3-coder 30B | 30 (reliable) | 26 (reliable) | 29 (reliable) | 25 (sometimes) | 29 (reliable) | 23 (sometimes) |
| qwen2.5-coder 32B | 24 (sometimes) | 0 (fails) | 0 (fails) | 28 (reliable) | 0 (fails) | 0 (fails) |
| qwen2.5-coder 14B | 27 (reliable) | 0 (fails) | 0 (fails) | 21 (sometimes) | 0 (fails) | 0 (fails) |
| qwen2.5-coder 7B | 12 (sometimes) | 0 (fails) | 0 (fails) | 4 (fails) | 0 (fails) | 0 (fails) |

Polyglot is the only agent at "sometimes" or better on all seven models. On the three qwen2.5-coder models, which
write their tool calls as text instead of through native function calling, pi, Hermes and opencode make no tool
call in any of the 30 runs, and goose makes some but completes no task.

## Polyglot builds

The Polyglot column is the first build (`polyglot-cli-final-*`). Two later builds with parser fixes were run on all
seven models. The rule, set before their results were in: a later build replaces the whole column only if its total
is the same or better; no model-by-model picking. Neither did, so the grid keeps the first build.
Future updates follow the released-build rule in [`METHODOLOGY.md`](../METHODOLOGY.md#updating-the-results):
the column comes from the current npm release, run once, whatever it scores.

| Model | First build (grid) | v2 | v3 |
|---|---|---|---|
| Qwen3.8-27B | 27 | 29 | 29 |
| gpt-oss 20B | 30 | 27 | 25 |
| Devstral Small 2 24B | 29 | 28 | 27 |
| qwen3-coder 30B | 30 | 29 | 29 |
| qwen2.5-coder 32B | 24 | 23 | 24 |
| qwen2.5-coder 14B | 27 | 26 | 26 |
| qwen2.5-coder 7B | 12 | 11 | 12 |
| **Total** | **179** | **173** | **172** |

The swing between builds is mostly the models: gpt-oss scored 30, 27 and 25 with no parse error among its misses.
Every parser gap the three runs surfaced is fixed in Polyglot 0.13.2. Failed-run transcripts are in each date's
`transcripts/`. Other `polyglot-cli-fixed*` files are intermediate builds from the same days, kept for the record.

## Efficiency

`harness/efficiency.py` reads the Ollama server log for each agent's window of a `run-all.sh` leg: first-turn
prompt size, peak context, prompt and output tokens per completed task, requests and seconds per completed task.

```bash
POLY_LABEL=polyglot-cli-final python3 harness/efficiency.py <run-all log> results/2026-09-29:results/2026-09-30 <model> <start date>
```

## Files

- Qwen3.8-27B · Polyglot: [`2026-09-30/polyglot-cli-final-qwen3.8-27b-toolfix.json`](2026-09-30/polyglot-cli-final-qwen3.8-27b-toolfix.json)
- Qwen3.8-27B · pi: [`2026-09-30/pi-qwen3.8-27b-toolfix.json`](2026-09-30/pi-qwen3.8-27b-toolfix.json)
- Qwen3.8-27B · goose: [`2026-09-30/goose-qwen3.8-27b-toolfix.json`](2026-09-30/goose-qwen3.8-27b-toolfix.json)
- Qwen3.8-27B · goose toolshim: [`2026-09-30/goose-toolshim-qwen3.8-27b-toolfix.json`](2026-09-30/goose-toolshim-qwen3.8-27b-toolfix.json)
- Qwen3.8-27B · Hermes: [`2026-09-30/hermes-qwen3.8-27b-toolfix.json`](2026-09-30/hermes-qwen3.8-27b-toolfix.json)
- Qwen3.8-27B · opencode: [`2026-09-30/opencode-qwen3.8-27b-toolfix.json`](2026-09-30/opencode-qwen3.8-27b-toolfix.json)
- gpt-oss 20B · Polyglot: [`2026-09-29/polyglot-cli-final-gpt-oss-20b-32k.json`](2026-09-29/polyglot-cli-final-gpt-oss-20b-32k.json)
- gpt-oss 20B · pi: [`2026-09-29/pi-gpt-oss-20b-32k.json`](2026-09-29/pi-gpt-oss-20b-32k.json)
- gpt-oss 20B · goose: [`2026-09-29/goose-gpt-oss-20b-32k.json`](2026-09-29/goose-gpt-oss-20b-32k.json)
- gpt-oss 20B · goose toolshim: [`2026-09-29/goose-toolshim-gpt-oss-20b-32k.json`](2026-09-29/goose-toolshim-gpt-oss-20b-32k.json)
- gpt-oss 20B · Hermes: [`2026-09-29/hermes-gpt-oss-20b-32k.json`](2026-09-29/hermes-gpt-oss-20b-32k.json)
- gpt-oss 20B · opencode: [`2026-09-29/opencode-gpt-oss-20b-32k.json`](2026-09-29/opencode-gpt-oss-20b-32k.json)
- Devstral Small 2 24B · Polyglot: [`2026-09-29/polyglot-cli-final-devstral-small-2-24b-32k.json`](2026-09-29/polyglot-cli-final-devstral-small-2-24b-32k.json)
- Devstral Small 2 24B · pi: [`2026-09-29/pi-devstral-small-2-24b-32k.json`](2026-09-29/pi-devstral-small-2-24b-32k.json)
- Devstral Small 2 24B · goose: [`2026-09-29/goose-devstral-small-2-24b-32k.json`](2026-09-29/goose-devstral-small-2-24b-32k.json)
- Devstral Small 2 24B · goose toolshim: [`2026-09-29/goose-toolshim-devstral-small-2-24b-32k.json`](2026-09-29/goose-toolshim-devstral-small-2-24b-32k.json)
- Devstral Small 2 24B · Hermes: [`2026-09-29/hermes-devstral-small-2-24b-32k.json`](2026-09-29/hermes-devstral-small-2-24b-32k.json)
- Devstral Small 2 24B · opencode: [`2026-09-29/opencode-devstral-small-2-24b-32k.json`](2026-09-29/opencode-devstral-small-2-24b-32k.json)
- qwen3-coder 30B · Polyglot: [`2026-09-30/polyglot-cli-final-qwen3-coder-30b-32k.json`](2026-09-30/polyglot-cli-final-qwen3-coder-30b-32k.json)
- qwen3-coder 30B · pi: [`2026-09-30/pi-qwen3-coder-30b-32k.json`](2026-09-30/pi-qwen3-coder-30b-32k.json)
- qwen3-coder 30B · goose: [`2026-09-30/goose-qwen3-coder-30b-32k.json`](2026-09-30/goose-qwen3-coder-30b-32k.json)
- qwen3-coder 30B · goose toolshim: [`2026-09-30/goose-toolshim-qwen3-coder-30b-32k.json`](2026-09-30/goose-toolshim-qwen3-coder-30b-32k.json)
- qwen3-coder 30B · Hermes: [`2026-09-30/hermes-qwen3-coder-30b-32k.json`](2026-09-30/hermes-qwen3-coder-30b-32k.json)
- qwen3-coder 30B · opencode: [`2026-09-30/opencode-qwen3-coder-30b-32k.json`](2026-09-30/opencode-qwen3-coder-30b-32k.json)
- qwen2.5-coder 32B · Polyglot: [`2026-09-30/polyglot-cli-final-qwen2.5-coder-32b-32k.json`](2026-09-30/polyglot-cli-final-qwen2.5-coder-32b-32k.json)
- qwen2.5-coder 32B · pi: [`2026-09-30/pi-qwen2.5-coder-32b-32k.json`](2026-09-30/pi-qwen2.5-coder-32b-32k.json)
- qwen2.5-coder 32B · goose: [`2026-09-30/goose-qwen2.5-coder-32b-32k.json`](2026-09-30/goose-qwen2.5-coder-32b-32k.json)
- qwen2.5-coder 32B · goose toolshim: [`2026-09-30/goose-toolshim-qwen2.5-coder-32b-32k.json`](2026-09-30/goose-toolshim-qwen2.5-coder-32b-32k.json)
- qwen2.5-coder 32B · Hermes: [`2026-09-30/hermes-qwen2.5-coder-32b-32k.json`](2026-09-30/hermes-qwen2.5-coder-32b-32k.json)
- qwen2.5-coder 32B · opencode: [`2026-09-30/opencode-qwen2.5-coder-32b-32k.json`](2026-09-30/opencode-qwen2.5-coder-32b-32k.json)
- qwen2.5-coder 14B · Polyglot: [`2026-09-29/polyglot-cli-final-qwen2.5-coder-14b-32k.json`](2026-09-29/polyglot-cli-final-qwen2.5-coder-14b-32k.json)
- qwen2.5-coder 14B · pi: [`2026-09-29/pi-qwen2.5-coder-14b-32k.json`](2026-09-29/pi-qwen2.5-coder-14b-32k.json)
- qwen2.5-coder 14B · goose: [`2026-09-29/goose-qwen2.5-coder-14b-32k.json`](2026-09-29/goose-qwen2.5-coder-14b-32k.json)
- qwen2.5-coder 14B · goose toolshim: [`2026-09-29/goose-toolshim-qwen2.5-coder-14b-32k.json`](2026-09-29/goose-toolshim-qwen2.5-coder-14b-32k.json)
- qwen2.5-coder 14B · Hermes: [`2026-09-29/hermes-qwen2.5-coder-14b-32k.json`](2026-09-29/hermes-qwen2.5-coder-14b-32k.json)
- qwen2.5-coder 14B · opencode: [`2026-09-29/opencode-qwen2.5-coder-14b-32k.json`](2026-09-29/opencode-qwen2.5-coder-14b-32k.json)
- qwen2.5-coder 7B · Polyglot: [`2026-09-29/polyglot-cli-final-qwen2.5-coder-7b-32k.json`](2026-09-29/polyglot-cli-final-qwen2.5-coder-7b-32k.json)
- qwen2.5-coder 7B · pi: [`2026-09-29/pi-qwen2.5-coder-7b-32k.json`](2026-09-29/pi-qwen2.5-coder-7b-32k.json)
- qwen2.5-coder 7B · goose: [`2026-09-29/goose-qwen2.5-coder-7b-32k.json`](2026-09-29/goose-qwen2.5-coder-7b-32k.json)
- qwen2.5-coder 7B · goose toolshim: [`2026-09-29/goose-toolshim-qwen2.5-coder-7b-32k.json`](2026-09-29/goose-toolshim-qwen2.5-coder-7b-32k.json)
- qwen2.5-coder 7B · Hermes: [`2026-09-29/hermes-qwen2.5-coder-7b-32k.json`](2026-09-29/hermes-qwen2.5-coder-7b-32k.json)
- qwen2.5-coder 7B · opencode: [`2026-09-29/opencode-qwen2.5-coder-7b-32k.json`](2026-09-29/opencode-qwen2.5-coder-7b-32k.json)

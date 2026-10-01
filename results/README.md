# Results

Raw captures, one folder per run date. Every JSON file records the agent, its version, the model, and each
run's outcome; failed Polyglot runs have full transcripts in `transcripts/`.

**Current result: the 30-run grid in [`GRID.md`](GRID.md).** Everything before 2026-09-29 predates the context
guard in `harness/run-all.sh`. Ollama's default 4,096-token context silently truncated the prompts of agents
with large system prompts (goose, Hermes, opencode), so their numbers in those folders are not a fair
tool-calling measurement. They are kept for the record, not for comparison.

| Folder | What it is | Status |
|---|---|---|
| `2026-09-10/` | First head-to-head: Polyglot, pi, Hermes on qwen2.5-coder 7B/14B and qwen3-coder, 3 trials per task | superseded |
| `2026-09-23/` | goose and goose's toolshim added, qwen2.5-coder 7B/14B | superseded (truncated context) |
| `2026-09-25/` | All agents on qwen2.5-coder 32B and qwen3-coder 30B | superseded (truncated context) |
| `2026-09-26/` | All agents on Qwen3.8-27B | superseded |
| `2026-09-29/` | The grid at 32k context: all agents on gpt-oss, Devstral, qwen2.5-coder 7B/14B; Polyglot builds | **grid** |
| `2026-09-29/3-trial/` | The same models at 3 trials per task, before the move to 5 | superseded by the 5-trial runs |
| `2026-09-30/` | The grid continued: all agents on Qwen3.8-27B, qwen3-coder 30B, qwen2.5-coder 32B; Polyglot v2 re-run | **grid** |
| `2026-10-01/` | Polyglot v3 re-run on all seven models | re-run, see `GRID.md` |

`polyglot-cli-fixed*` files are intermediate Polyglot builds from the same days. Local paths and the machine's
username in the captures are replaced with `~/polyglot/` and `user`.

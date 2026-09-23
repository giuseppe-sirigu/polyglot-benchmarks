# Summary — 2026-09-23: Goose added to the comparison

Same methodology as 2026-09-10 (3 trials/scenario, same 6 scenarios, `done()` + `verify`
command). Goose ([aaif-goose/goose](https://github.com/aaif-goose/goose), Linux Foundation
Agentic AI Foundation, ~54,600 GitHub stars — by far the largest project in this comparison) run
via `harness/run-goose.mjs` in two configurations: default, and with Goose's own documented
`GOOSE_TOOLSHIM` fault-tolerance mechanism explicitly enabled (interpreter model:
`llama3.2:3b`, since the default `mistral-nemo` wasn't already pulled on this machine — worth
re-testing with `mistral-nemo` for full fidelity to their intended default).

| model | Polyglot | pi | Hermes | Goose (default) | Goose (toolshim) |
|---|---|---|---|---|---|
| qwen2.5-coder:7b | **7/18 (39%)** | 0/18 | 0/18 | **0/18** | **0/18** |
| qwen2.5-coder:14b | ~79% (history) | not run | 0/18 | **0/18** | **1/18 (6%)** |

## What actually happens with Goose (default, no toolshim)

Every one of the 36 default-mode runs showed the identical pattern (verified directly in a
smoke test, consistent with every run's logged tool-call count of exactly 1): the model emits a
plausible tool call as a JSON-shaped **plain-text** assistant message
(`{"name": "edit", "arguments": {...}}`), Goose never recognizes it as a call - no
`toolCall`/`toolResponse` content block ever appears - and the session ends with
`"status": "completed"` after a single turn, having touched nothing. This is the exact same
"the agent loop never engages" failure as pi and Hermes, just via a different symptom: pi/Hermes
stall/retry against an empty native channel, Goose declares false victory immediately.

## What happens with the toolshim enabled

The toolshim visibly changes behavior - real `toolCall`/`toolResponse` content blocks appear,
and runs use anywhere from 1 to 21 tool-call attempts (vs. exactly 1 in every default run) - so
the mechanism is doing *something*. It just doesn't translate into completed tasks: 0/18 on the
7B, 1/18 on the 14B. Observed failure modes include tool-schema mismatches (`Tool 'find_path'
was not advertised for this model turn`) and simply running out of the turn budget without
finishing. Goose's own GitHub has an open, unresolved documentation issue (#8269) asking "when
to enable [the toolshim], which models need it" - consistent with what was found here: it's a
real, shipped mechanism, not vaporware, but it doesn't yet close this gap in practice, at least
not with an unofficial interpreter model substitution.

## Caveats (read before citing this externally)

- **Not an official Goose benchmark, not reviewed by their team.** This is a good-faith
  replication using their documented public CLI and env vars, run once on 2026-09-23.
- **Toolshim interpreter model substituted** (`llama3.2:3b` instead of their default
  `mistral-nemo`, which wasn't already downloaded on this machine) - re-run with the real
  default before treating the toolshim number as final.
- **`toolCalls` in the raw JSON is a heuristic**, not authoritative - see the comment in
  `harness/run-goose.mjs`. The *pass/fail* numbers (the actual finding) come from the same
  `done()`/`verify` check every other agent in this comparison uses, and don't depend on the
  heuristic.
- Only two model sizes tested (matching what was already pulled locally); Goose's own docs
  specifically recommend Qwen2.5-Coder/Qwen3-Coder as "reliable enough" models - the qwen3-coder
  strong-native-FC comparison point (where Polyglot and pi both converge near 99%/89%) hasn't
  been re-run against Goose yet.

## Takeaway

Goose - a Linux Foundation-governed project with platinum backing from AWS, Anthropic, Block,
Bloomberg, Cloudflare, Google, and Microsoft, and a shipped mechanism built specifically to
address this exact failure mode - performs statistically the same as pi and Hermes on this
benchmark: **0% on the 7B, 0-6% on the 14B**, against Polyglot's 39%/~79%. Scale and institutional
backing did not close this gap. The wedge holds up under direct, hostile testing against the
single most credible potential counter-example found in this round of competitive research.

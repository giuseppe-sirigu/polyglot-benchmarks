#!/usr/bin/env bash
# Runs every tool (pi, Goose default, Goose toolshim, Hermes, opencode, Polyglot) against one
# model in sequence, so testing a new model - e.g. a scale check like qwen2.5-coder:32b
# - is one command instead of five. Mirrors each individual run-*.mjs/.sh script's own
# defaults exactly; this is a thin sequencer, not a reimplementation.
#
#   ./run-all.sh qwen2.5-coder:32b 3
#   POLYGLOT_REPO=~/path/to/polyglot ./run-all.sh qwen2.5-coder:32b 3
#   SKIP=hermes,goose-toolshim ./run-all.sh qwen2.5-coder:32b 3   # skip specific legs
#
# A failing leg (tool not installed, model not pulled, a real crash) is logged and
# skipped, not fatal - the point of one command is to walk away and come back to
# whatever did finish, not to lose a 30-minute Polyglot run because Hermes wasn't
# installed. Exit code is the count of failed legs (0 = everything ran).
set -uo pipefail

MODEL="${1:?usage: run-all.sh <model> [trials]}"
TRIALS="${2:-3}"
SKIP="${SKIP:-}"
HARNESS_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$HARNESS_DIR"

should_skip() {
  [[ ",$SKIP," == *",$1,"* ]]
}

# Ollama's default context (4096 here) silently truncates any prompt over the limit to half of
# it. Agents with large system prompts (goose ~6-7k tokens, Hermes, opencode) then run on a
# prompt missing most of their instructions and the task, so they "fail" for a reason that has
# nothing to do with tool calling. That invalidated the 2026-09-23/25 goose, Hermes and opencode
# numbers. Refuse to run unless the model's own num_ctx is large enough; create a variant with
# `ollama create <name>-32k` (FROM <model> + PARAMETER num_ctx 32768) - see METHODOLOGY.md.
MIN_CTX="${MIN_CTX:-16384}"
MODEL_CTX="$(ollama show "$MODEL" --modelfile 2>/dev/null | awk 'tolower($1)=="parameter" && $2=="num_ctx" {print $3}' | tail -1)"
if [[ -z "$MODEL_CTX" || "$MODEL_CTX" -lt "$MIN_CTX" ]]; then
  echo "refusing to run: $MODEL has num_ctx=${MODEL_CTX:-default (4096)}, below MIN_CTX=$MIN_CTX." >&2
  echo "Ollama would silently truncate long agent prompts. Create a variant with a larger num_ctx." >&2
  exit 100
fi

# After each leg, count Ollama's "truncating input prompt" warnings since the leg started. Any
# truncation means that leg's numbers are not a fair tool-calling measurement.
truncations_since() {
  journalctl -u ollama --since "$1" --no-pager 2>/dev/null | grep -c "truncating input prompt" || true
}

FAILED=0
RUN_LOG=()

run_leg() {
  local name="$1"
  shift
  if should_skip "$name"; then
    echo "=== [$name] skipped (SKIP=$SKIP) ==="
    RUN_LOG+=("$name: skipped")
    return
  fi
  echo
  local started
  started="$(date '+%F %T')"
  echo "=== [$name] $MODEL, $TRIALS trial(s) — starting $(date +%T) ==="
  if "$@"; then
    echo "=== [$name] done $(date +%T) ==="
    RUN_LOG+=("$name: ok")
  else
    echo "=== [$name] FAILED (exit $?) - continuing to the next leg ==="
    RUN_LOG+=("$name: FAILED")
    FAILED=$((FAILED + 1))
  fi
  local truncated
  truncated="$(truncations_since "$started")"
  if [[ "$truncated" -gt 0 ]]; then
    echo "=== [$name] WARNING: Ollama truncated $truncated prompt(s) during this leg - results not valid ==="
    RUN_LOG+=("$name: INVALID ($truncated truncated prompts)")
    echo "$name $MODEL $truncated" >>"$HARNESS_DIR/../results/$(date +%F)/TRUNCATED.txt"
  fi
}

run_leg "pi" node run-pi.mjs "$MODEL" "$TRIALS"
run_leg "goose" node run-goose.mjs "$MODEL" "$TRIALS"
run_leg "goose-toolshim" env GOOSE_HARNESS_TOOLSHIM=1 GOOSE_HARNESS_TOOLSHIM_MODEL="${GOOSE_HARNESS_TOOLSHIM_MODEL:-llama3.2:3b}" node run-goose.mjs "$MODEL" "$TRIALS"
run_leg "hermes" node run-hermes.mjs "$MODEL" "$TRIALS"
run_leg "opencode" node run-opencode.mjs "$MODEL" "$TRIALS"
run_leg "polyglot" ./run-polyglot.sh "$MODEL" "$TRIALS"
# Polyglot through its public CLI, scored exactly like every other agent (see run-polyglot-cli.mjs).
run_leg "polyglot-cli" node run-polyglot-cli.mjs "$MODEL" "$TRIALS"

echo
echo "=== Summary: $MODEL ==="
printf '%s\n' "${RUN_LOG[@]}"
echo
echo "Results in: $HARNESS_DIR/../results/$(date +%F)/"
if [[ $FAILED -gt 0 ]]; then
  echo "$FAILED leg(s) failed - see log above for which."
fi
exit "$FAILED"

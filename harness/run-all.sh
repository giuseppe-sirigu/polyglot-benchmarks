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
  echo "=== [$name] $MODEL, $TRIALS trial(s) — starting $(date +%T) ==="
  if "$@"; then
    echo "=== [$name] done $(date +%T) ==="
    RUN_LOG+=("$name: ok")
  else
    echo "=== [$name] FAILED (exit $?) - continuing to the next leg ==="
    RUN_LOG+=("$name: FAILED")
    FAILED=$((FAILED + 1))
  fi
}

run_leg "pi" node run-pi.mjs "$MODEL" "$TRIALS"
run_leg "goose" node run-goose.mjs "$MODEL" "$TRIALS"
run_leg "goose-toolshim" env GOOSE_HARNESS_TOOLSHIM=1 GOOSE_HARNESS_TOOLSHIM_MODEL="${GOOSE_HARNESS_TOOLSHIM_MODEL:-llama3.2:3b}" node run-goose.mjs "$MODEL" "$TRIALS"
run_leg "hermes" node run-hermes.mjs "$MODEL" "$TRIALS"
run_leg "opencode" node run-opencode.mjs "$MODEL" "$TRIALS"
run_leg "polyglot" ./run-polyglot.sh "$MODEL" "$TRIALS"

echo
echo "=== Summary: $MODEL ==="
printf '%s\n' "${RUN_LOG[@]}"
echo
echo "Results in: $HARNESS_DIR/../results/$(date +%F)/"
if [[ $FAILED -gt 0 ]]; then
  echo "$FAILED leg(s) failed - see log above for which."
fi
exit "$FAILED"

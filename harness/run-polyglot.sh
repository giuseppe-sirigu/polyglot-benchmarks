#!/usr/bin/env bash
# Runs Polyglot's own scenario harness against local models and copies the summary
# into results/. Polyglot uses the SAME 6 scenarios (they live in its repo at
# packages/core/src/testing/scenarios.ts); this benchmark's scenarios.mjs is a
# faithful transcription for the other tools.
#
#   POLYGLOT_REPO=../../polyglot ./run-polyglot.sh "qwen2.5-coder:7b" 3
set -euo pipefail
REPO="${POLYGLOT_REPO:-$(cd "$(dirname "$0")/../.." && pwd)/polyglot}"
MODEL="${1:-qwen2.5-coder:7b}"
RUNS="${2:-3}"
DATE="$(date +%F)"
OUT="$(cd "$(dirname "$0")/../results/$DATE" && pwd)"
mkdir -p "$OUT"
for r in $(seq 1 "$RUNS"); do
  echo "=== Polyglot scenario:live · $MODEL · run $r ==="
  ( cd "$REPO" && SCENARIO_MODELS="$MODEL" pnpm scenario:live )
done | tee "$OUT/polyglot-${MODEL//[^A-Za-z0-9.-]/-}.txt"
# Polyglot's own longitudinal record:
cp "$REPO/scenario-results.jsonl" "$OUT/polyglot-scenario-results.jsonl" 2>/dev/null || true

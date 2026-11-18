#!/bin/sh
# Runs the tests marked `stress` (processes racing each other) in a loop while the whole suite
# runs beside them, as the load that turned up their races: each run of them must pass.
# Usage: scripts/test_under_load.sh [pytest arguments for the suite beside, e.g. tests/core]
set -u
out=$(mktemp -d)
uv run pytest -q -p no:cacheprovider "$@" >"$out/suite.txt" 2>&1 &
suite=$!
runs=0 failed=0
while kill -0 "$suite" 2>/dev/null; do
    runs=$((runs + 1))
    if ! uv run pytest -q -p no:cacheprovider -m stress >"$out/run.txt" 2>&1; then
        failed=$((failed + 1))
        cp "$out/run.txt" "$out/failed-$failed.txt"
    fi
done
wait "$suite"
beside=$?
echo "the stress tests: $runs runs, $failed failed; the suite beside: $(tail -n 1 "$out/suite.txt")"
# What failed, in full, as CI keeps no file: pytest's report of its failures in each.
for file in "$out/suite.txt" "$out"/failed-*.txt; do
    [ -e "$file" ] && sed -n '/^=* FAILURES =*$/,/^=* short test summary info =*$/p' "$file"
done
[ "$failed" -eq 0 ] || echo "see $out/failed-*.txt" >&2
[ "$failed" -eq 0 ] && [ "$beside" -eq 0 ]

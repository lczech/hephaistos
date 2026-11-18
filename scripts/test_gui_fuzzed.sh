#!/bin/sh
# Runs the tests of the GUI fuzzed (gui/web/src/test/fuzz.ts): the stand-in for the Server
# answering after random delays, so in any order, and queries refetched at random moments; each
# round with a seed of its own. A failing round names its seed; TEST_FUZZ_SEED=<seed> replays it.
# Usage: scripts/test_gui_fuzzed.sh [rounds [vitest arguments]]
#   default: 5 rounds of the tests in a simulated browser (--project web)
set -u
rounds=${1:-5}
[ $# -gt 0 ] && shift
[ $# -eq 0 ] && set -- --project web
out=$(mktemp -d)
cd "$(dirname "$0")/../gui" || exit 1
failed=""
round=0
while [ "$round" -lt "$rounds" ]; do
    round=$((round + 1))
    seed=${TEST_FUZZ_SEED:-$(od -An -N4 -tu4 /dev/urandom | tr -d ' ')}
    # Uncoloured, as vitest colours where CI is set, for the lines matched below.
    if TEST_FUZZ_SEED=$seed NO_COLOR=1 uv run npm exec -- vitest run "$@" >"$out/$seed.txt" 2>&1; then
        echo "round $round, seed $seed: $(grep -E '^ +Tests ' "$out/$seed.txt" | tr -s ' ')"
        rm "$out/$seed.txt"
    else
        echo "round $round, seed $seed: failed, see $out/$seed.txt"
        # Each failed test and its error, as CI keeps no file.
        grep -E -A1 '^ FAIL ' "$out/$seed.txt" | grep -v '^--$'
        failed="$failed $seed"
    fi
done
if [ -n "$failed" ]; then
    echo "failed with seeds:$failed" >&2
    exit 1
fi

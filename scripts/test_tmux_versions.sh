#!/bin/sh
# Runs the tests marked `tmux` with the given tmux versions, each installed once from
# conda-forge by micromamba (fetched too, if missing). Needs no root and no compiler.
# Usage: scripts/test_tmux_versions.sh [version...]   default: our minimum and each minor since
set -u
versions=${*:-3.2a 3.3a 3.4 3.5a 3.6b 3.7c_ 3.8_}
cache="${XDG_CACHE_HOME:-$HOME/.cache}/hephaistos/tmux"
failed=""

micromamba=$(command -v micromamba)
if [ -z "$micromamba" ]; then
    micromamba="$cache/bin/micromamba"
    if [ ! -x "$micromamba" ]; then
        echo "== fetching micromamba into $cache"
        mkdir -p "$cache"
        curl -fsSL https://micro.mamba.pm/api/micromamba/linux-64/latest \
            | tar -xj -C "$cache" bin/micromamba || exit 1
    fi
fi

for version in $versions; do
    prefix="$cache/$version"
    if [ ! -x "$prefix/bin/tmux" ]; then
        echo "== installing tmux $version into $prefix"
        if ! "$micromamba" create --yes --quiet --prefix "$prefix" --channel conda-forge \
            --override-channels "tmux==$version" >/dev/null; then
            echo "installing tmux $version failed" >&2
            failed="$failed $version"
            continue
        fi
    fi
    echo "== $("$prefix/bin/tmux" -V)"
    PATH="$prefix/bin:$PATH" uv run pytest -q -m tmux || failed="$failed $version"
done

if [ -n "$failed" ]; then
    echo "failed with tmux:$failed" >&2
    exit 1
fi

#!/bin/sh
# Runs the tests with the given git versions, each built once from source.
# Usage: scripts/test_git_versions.sh [version...]   default: those on our Machines
set -u
versions=${*:-2.43.7 2.47.3 2.53.0}
cache="${XDG_CACHE_HOME:-$HOME/.cache}/hephaistos/git"
failed=""

for version in $versions; do
    prefix="$cache/$version"
    if [ ! -x "$prefix/bin/git" ]; then
        echo "== building git $version into $prefix"
        build=$(mktemp -d)
        # The tests use local repositories only: no network or translation support needed.
        if ! curl -fsSL "https://mirrors.edge.kernel.org/pub/software/scm/git/git-$version.tar.xz" \
            | tar -xJ -C "$build" \
            || ! make -C "$build/git-$version" -j"$(nproc)" prefix="$prefix" \
                NO_CURL=1 NO_OPENSSL=1 NO_EXPAT=1 NO_GETTEXT=1 NO_TCLTK=1 NO_PERL=1 NO_PYTHON=1 \
                install >"$build/make.log" 2>&1; then
            echo "building git $version failed; see $build" >&2
            failed="$failed $version"
            continue
        fi
        rm -rf "$build"
    fi
    echo "== $("$prefix/bin/git" --version)"
    PATH="$prefix/bin:$PATH" uv run pytest -q || failed="$failed $version"
done

if [ -n "$failed" ]; then
    echo "failed with git:$failed" >&2
    exit 1
fi

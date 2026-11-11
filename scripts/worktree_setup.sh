#!/bin/sh
# Prepares a new worktree: its .agents/scratch/ becomes a link to the main checkout's, so that the
# scripts and notes kept there are the same in every checkout and outlive the worktree.
# Orca runs it in each worktree it creates (orca.yaml); elsewhere, run it once in the worktree.
# Usage: scripts/worktree_setup.sh
set -eu
cd "$(git rev-parse --show-toplevel)"
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
[ "$main" = "$PWD" ] && exit 0 # the main checkout keeps its own

mkdir -p "$main/.agents/scratch" .agents
[ -L .agents/scratch ] && exit 0
if [ -d .agents/scratch ]; then
    rmdir .agents/scratch 2>/dev/null || {
        echo "error: .agents/scratch/ has files: move them to $main/.agents/scratch/ first" >&2
        exit 1
    }
fi
ln -s "$main/.agents/scratch" .agents/scratch
echo ".agents/scratch -> $main/.agents/scratch"

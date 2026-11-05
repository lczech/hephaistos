#!/bin/sh
# Opens this worktree's GUI in a Desktop window of its own, to try it before it reaches main.
# Its Daemon is a scratch one (scratch_daemon.sh) running this worktree's code, on a copy of the
# real data and settings: never the real Daemon. One instance per worktree, kept across starts:
# its data, settings, port and the window's saved Layout.
# Usage: scripts/worktree_gui.sh start [--fresh|--empty] | stop [<name>|--all]
#        | remove [<name>] | list | prune
#   start   builds, starts the Daemon if needed, opens the window; quitting it stops the Daemon.
#           --fresh copies the real data again; --empty starts without data.
#   stop    closes the window and stops the Daemon: this worktree's, a named one's, or all.
#   remove  stops, then deletes the instance: before removing its worktree.
#   list    the instances: running or not, and whether their worktree is gone.
#   prune   removes the instances whose worktree is gone.
# WORKTREE_GUI_ROOT changes where instances live (default ~/.cache/agents/hephaistos/wt).
set -u
root=${WORKTREE_GUI_ROOT:-$HOME/.cache/agents/hephaistos/wt}
repo=$(cd "$(dirname "$0")/.." && pwd)
heph="$repo/.venv/bin/hephaistos"
python="$repo/.venv/bin/python"
first_port=8300 # upwards; the scratch Daemon has 8299, the real one 8264

die() {
    echo "error: $*" >&2
    exit 1
}

# The repository's main checkout, whose GUI the real Daemon serves.
main_checkout() {
    dirname "$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)"
}

# An instance's directory, by name; without one, this worktree's.
instance() {
    if [ -n "${1:-}" ]; then
        [ -e "$root/$1/worktree" ] || die "no instance $1; see \`$0 list\`"
        echo "$root/$1"
    else
        [ "$(main_checkout)" != "$repo" ] || die "this is the main checkout: name an instance"
        echo "$root/$(basename "$repo")"
    fi
}

scratch() { # <instance> <command>: scratch_daemon.sh on the instance's home and port
    SCRATCH_HOME="$1/home" SCRATCH_PORT="$(cat "$1/port")" SCRATCH_WATCHER=on \
        "$repo/scripts/scratch_daemon.sh" "$2"
}

# The instance's Desktop, found by the app it runs, its worktree's: never the real Desktop.
# Not by its environment, which Chromium overwrites when it sets its processes' titles; it
# also joins their arguments with spaces.
desktop_pids() {
    app="$(cat "$1/worktree")/gui"
    for pid in $(pgrep -f "electron/dist/electron"); do
        case "$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null) " in
        /*/electron/dist/electron" $app "*) echo "$pid" ;;
        esac
    done
}

# A port no instance has and nothing listens on.
free_port() {
    port=$first_port
    while cat "$root"/*/port 2>/dev/null | grep -qx "$port" ||
        ! "$python" -c 'import socket, sys; socket.socket().bind(("127.0.0.1", int(sys.argv[1])))' \
            "$port" 2>/dev/null; do
        port=$((port + 1))
        [ $port -lt $((first_port + 100)) ] || die "no free port from $first_port on"
    done
    echo "$port"
}

version() { # of an npm package, from its package.json
    "$python" -c 'import json, sys; print(json.load(open(sys.argv[1]))["version"])' "$1" 2>/dev/null
}

# The Python environment, the npm packages when their lock changed, and the GUI and Desktop.
build() {
    main=$(main_checkout)
    gui="$repo/gui"
    uv run --project "$repo" true || return 1
    if [ ! -e "$gui/node_modules/.package-lock.json" ] ||
        [ "$gui/package-lock.json" -nt "$gui/node_modules/.package-lock.json" ]; then
        uv run --project "$repo" npm --prefix "$gui" ci || return 1
    fi
    # Main's Electron: AppArmor lets only that binary use Chromium's sandbox (`desktop install`).
    theirs="$main/gui/node_modules/electron"
    [ -x "$theirs/dist/electron" ] || die "the main checkout has no Electron: \`hephaistos desktop install\` there"
    [ "$(version "$gui/node_modules/electron/package.json")" = "$(version "$theirs/package.json")" ] ||
        die "this worktree's Electron isn't the main checkout's version; try it once main has it"
    dist="$gui/node_modules/electron/dist"
    [ -L "$dist" ] || rm -rf "$dist"
    ln -sfn "$theirs/dist" "$dist"
    uv run --project "$repo" npm --prefix "$gui" run build
}

# Copies the real database, as one consistent snapshot, and the config files into a home.
snapshot() {
    "$python" - "$1" <<'EOF'
import os, shutil, sqlite3, sys
from hephaistos.core.utils.paths import Paths, private_directory

real = Paths.from_environment({k: v for k, v in os.environ.items() if k != "HEPHAISTOS_HOME"})
copy = Paths.from_environment({**os.environ, "HEPHAISTOS_HOME": sys.argv[1]})
private_directory(copy.data_dir)
source = sqlite3.connect(f"file:{real.database}?mode=ro", uri=True)
target = sqlite3.connect(copy.database)
source.backup(target)
source.close()
target.close()
for path in real.config_dir.glob("*.toml"):
    shutil.copy2(path, copy.config_dir)
EOF
}

# Waits until the Daemon's Server listens; else says why, from the Daemon's output.
await_server() {
    tries=100 # every 0.2 s
    while [ $tries -gt 0 ]; do
        HEPHAISTOS_HOME="$1/home" "$heph" daemon token --url >/dev/null 2>&1 && return 0
        scratch "$1" running || break
        sleep 0.2
        tries=$((tries - 1))
    done
    echo "error: the daemon didn't start; the end of $1/home/daemon.out:" >&2
    tail -n 5 "$1/home/daemon.out" >&2
    echo "if the copied data or settings don't fit this worktree's code: \`$0 start --fresh\`" \
        "copies them again, \`--empty\` starts without data" >&2
    return 1
}

stop_instance() {
    if [ -e "$1/watcher.pid" ]; then
        kill "$(cat "$1/watcher.pid")" 2>/dev/null
        rm -f "$1/watcher.pid"
    fi
    pids=$(desktop_pids "$1")
    [ -z "$pids" ] || kill -TERM $pids
    if scratch "$1" running; then scratch "$1" stop >/dev/null; fi
}

start() {
    fresh= empty=
    case ${1:-} in
    --fresh) fresh=1 ;;
    --empty) fresh=1 empty=1 ;;
    "") ;;
    *) usage ;;
    esac
    [ "$(main_checkout)" != "$repo" ] ||
        die "this is the main checkout, whose GUI the real daemon serves: \`uv run npm --prefix gui run build\` instead"
    name=$(basename "$repo")
    dir="$root/$name"
    if [ -e "$dir/worktree" ] && [ "$(cat "$dir/worktree")" != "$repo" ]; then
        die "instance $name is the worktree $(cat "$dir/worktree")'s; remove it there, or rename this one"
    fi
    if [ -n "$fresh" ] && [ -e "$dir/port" ]; then
        stop_instance "$dir"
        rm -rf "$dir/home"
    fi
    mkdir -p "$dir"
    echo "$repo" >"$dir/worktree"
    build || exit 1 # first: the port's check needs its Python
    [ -s "$dir/port" ] || { port=$(free_port) && echo "$port" >"$dir/port"; } || exit 1
    if [ ! -e "$dir/home/data" ] && [ -z "$empty" ]; then
        snapshot "$dir/home" || exit 1
    fi
    if ! scratch "$dir" running; then scratch "$dir" start >/dev/null || exit 1; fi
    await_server "$dir" || exit 1
    HEPHAISTOS_HOME="$dir/home" HEPHAISTOS_DESKTOP_LABEL="$name" "$heph" desktop open || exit 1
    if ! { [ -e "$dir/watcher.pid" ] && kill -0 "$(cat "$dir/watcher.pid")" 2>/dev/null; }; then
        setsid nohup "$repo/scripts/worktree_gui.sh" _watch "$dir" >/dev/null 2>&1 &
        echo $! >"$dir/watcher.pid"
    fi
}

# Stops the Daemon once the window is gone.
watch() {
    while [ -n "$(desktop_pids "$1")" ]; do sleep 2; done
    rm -f "$1/watcher.pid"
    if scratch "$1" running; then scratch "$1" stop >/dev/null; fi
}

list() {
    for dir in "$root"/*/; do
        dir=${dir%/}
        [ -e "$dir/worktree" ] || continue
        worktree=$(cat "$dir/worktree")
        if scratch "$dir" running; then state=running; else state=stopped; fi
        [ -d "$worktree" ] || worktree="$worktree (gone)"
        printf '%-24s %-6s %-8s %s\n' "$(basename "$dir")" "$(cat "$dir/port")" "$state" "$worktree"
    done
}

prune() {
    for dir in "$root"/*/; do
        dir=${dir%/}
        [ -e "$dir/worktree" ] && [ ! -d "$(cat "$dir/worktree")" ] || continue
        stop_instance "$dir"
        rm -rf "$dir"
        echo "removed $(basename "$dir")"
    done
}

usage() {
    echo "usage: $0 start [--fresh|--empty] | stop [<name>|--all] | remove [<name>] | list | prune" >&2
    exit 2
}

case ${1:-} in
start) start "${2:-}" ;;
stop)
    if [ "${2:-}" = --all ]; then
        for dir in "$root"/*/; do [ -e "$dir/worktree" ] && stop_instance "${dir%/}"; done
    else
        dir=$(instance "${2:-}") || exit 1
        stop_instance "$dir"
    fi
    ;;
remove)
    dir=$(instance "${2:-}") || exit 1
    stop_instance "$dir"
    rm -rf "$dir"
    ;;
list) list ;;
prune) prune ;;
_watch) watch "$2" ;;
*) usage ;;
esac

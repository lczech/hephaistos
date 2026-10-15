#!/bin/sh
# Runs a throwaway Daemon from this checkout, away from the real one: its data in a scratch
# HEPHAISTOS_HOME, its Server on another port, its Watcher passing only on request.
# Usage: scripts/scratch_daemon.sh start|stop|status
#   then e.g. HEPHAISTOS_HOME=/tmp/hephaistos-scratch hephaistos scan ~/Repos
# SCRATCH_HOME and SCRATCH_PORT change where (default /tmp/hephaistos-scratch, 8299).
set -u
home=${SCRATCH_HOME:-/tmp/hephaistos-scratch}
port=${SCRATCH_PORT:-8299}
repo=$(cd "$(dirname "$0")/.." && pwd)
heph="$repo/.venv/bin/hephaistos"
export HEPHAISTOS_HOME="$home"

# The scratch Daemon's processes, found by their HEPHAISTOS_HOME: never the real Daemon's.
pids() {
    for pid in $(pgrep -f "hephaistos daemon run"); do
        if tr '\0' '\n' <"/proc/$pid/environ" 2>/dev/null | grep -qx "HEPHAISTOS_HOME=$home"; then
            echo "$pid"
        fi
    done
}

case ${1:-} in
start)
    if [ -n "$(pids)" ]; then
        echo "the scratch Daemon runs already" >&2
        exit 1
    fi
    uv run --project "$repo" true || exit 1 # the environment, up to date
    [ -e "$home/data" ] || "$heph" setup --name scratch || exit 1
    HEPHAISTOS_SERVER_PORT=$port HEPHAISTOS_WATCHER_INTERVAL=0 \
        nohup "$heph" daemon run >"$home/daemon.out" 2>&1 &
    echo "started; its output in $home/daemon.out"
    echo "open the GUI: HEPHAISTOS_HOME=$home hephaistos daemon token --url"
    ;;
stop)
    found=$(pids)
    if [ -z "$found" ]; then
        echo "the scratch Daemon doesn't run" >&2
        exit 1
    fi
    kill -TERM $found && echo "stopped"
    ;;
status)
    "$heph" daemon status
    ;;
*)
    echo "usage: $0 start|stop|status" >&2
    exit 2
    ;;
esac

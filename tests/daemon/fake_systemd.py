# ruff: noqa: T201, C901 - prints as systemctl does; one branch per command
"""Stands in for `systemctl --user` and `loginctl` in tests, as a script of either name.

Keeps its state in FAKE_SYSTEMD (a directory): `calls` lists each call, `state.json` whether our
unit is enabled and the pid it runs. It starts `ExecStart` of the unit in $HOME's
~/.config/systemd/user, with this environment, and stops it with SIGTERM. With
FAKE_SYSTEMD_UNAVAILABLE set, systemctl fails as without a user session.
"""

import getpass
import json
import os
import shlex
import signal
import subprocess
import sys
import time
from pathlib import Path

UNIT = "hephaistos.service"
STATE = Path(os.environ["FAKE_SYSTEMD"])
UNIT_FILE = Path.home() / ".config" / "systemd" / "user" / UNIT


def _state() -> dict[str, object]:
    try:
        return json.loads((STATE / "state.json").read_text())
    except FileNotFoundError:
        return {"enabled": False, "pid": None, "status": None}


def _save(state: dict[str, object]) -> None:
    (STATE / "state.json").write_text(json.dumps(state))


def _alive(pid: object) -> bool:
    """Whether a process runs, not counting zombies (it was started by an earlier call)."""
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
    except (FileNotFoundError, ProcessLookupError, IndexError):  # gone, even while reading
        return False
    return isinstance(pid, int) and fields[0] != "Z"


def _start(state: dict[str, object]) -> None:
    if _alive(state["pid"]):
        return
    line = next(
        line for line in UNIT_FILE.read_text().splitlines() if line.startswith("ExecStart=")
    )
    command = shlex.split(line.removeprefix("ExecStart=").replace("%%", "%"))
    log = (STATE / "daemon.log").open("a")
    process = subprocess.Popen(command, stdout=log, stderr=log, start_new_session=True)
    state["pid"] = process.pid


def _stop(state: dict[str, object]) -> None:
    pid = state["pid"]
    if _alive(pid):
        assert isinstance(pid, int)
        os.kill(pid, signal.SIGTERM)
        while _alive(pid):
            time.sleep(0.02)
    state["pid"] = None


def systemctl(args: list[str]) -> int:
    if os.environ.get("FAKE_SYSTEMD_UNAVAILABLE"):
        print("Failed to connect to bus: No medium found", file=sys.stderr)
        return 1
    assert args[0] == "--user", args
    command, *rest = args[1:]
    state = _state()
    match command:
        case "show-environment" | "daemon-reload":
            pass
        case "show":
            running = _alive(state["pid"])
            print(f"LoadState={'loaded' if UNIT_FILE.exists() else 'not-found'}")
            print(f"UnitFileState={'enabled' if state['enabled'] else 'disabled'}")
            print(f"ActiveState={'active' if running else 'inactive'}")
            print("ExecMainStatus=0")
        case "enable":
            state["enabled"] = True
            if "--now" in rest:
                _start(state)
        case "disable":
            state["enabled"] = False
            if "--now" in rest:
                _stop(state)
        case "start":
            _start(state)
        case "stop":
            _stop(state)
        case "restart":
            _stop(state)
            _start(state)
        case _:
            print(f"unknown command {command}", file=sys.stderr)
            return 1
    _save(state)
    return 0


def loginctl(args: list[str]) -> int:
    assert args == ["enable-linger"], args
    linger = Path(os.environ["FAKE_LINGER_DIR"])
    linger.mkdir(parents=True, exist_ok=True)
    (linger / getpass.getuser()).touch()
    return 0


if __name__ == "__main__":
    name, args = Path(sys.argv[0]).name, sys.argv[1:]
    with (STATE / "calls").open("a") as calls:
        calls.write(shlex.join([name, *args]) + "\n")
    sys.exit(systemctl(args) if name == "systemctl" else loginctl(args))

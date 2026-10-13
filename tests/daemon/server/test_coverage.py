"""Every command that prints JSON has an endpoint returning it, so that GUIs see what it shows.

`test_api` checks that each returns the same JSON; this only that none is forgotten.
"""

from collections.abc import Iterator
from typing import Any

import typer.main

from hephaistos.cli.main import app as cli
from hephaistos.core.registry import machines
from hephaistos.core.utils.paths import Paths
from support import openapi

ROUTES = {
    "machine list": "/api/machines",
    "machine show": "/api/machines/{machine_id}",
    "repo list": "/api/repositories",
    "repo show": "/api/repositories/{repository_id}",
    "clone list": "/api/clones",
    "clone show": "/api/clones/{clone_id}",
    "worktree list": "/api/worktrees",
    "worktree show": "/api/worktrees/{worktree_id}",
    "event list": "/api/events",
    "event show": "/api/events/{event_id}",
    "event kinds": "/api/events/kinds",
    "db tables": "/api/db/tables",
    "db dump": "/api/db/tables/{table}",
    "log show": "/api/log",
    "config show": "/api/config",
    "daemon status": "/api/daemon",
}


def _json_commands(command: Any, path: tuple[str, ...] = ()) -> Iterator[str]:  # noqa: ANN401 - Click's commands, untyped
    """The commands under `command` that take `--json`, by their words."""
    if hasattr(command, "list_commands"):
        for name in command.list_commands(None):
            yield from _json_commands(command.get_command(None, name), (*path, name))
    elif any("--json" in getattr(parameter, "opts", ()) for parameter in command.params):
        yield " ".join(path)


def test_every_json_command_has_an_endpoint(paths: Paths) -> None:
    machines.set_up(paths, "laptop")
    commands = set(_json_commands(typer.main.get_command(cli)))
    assert commands, "no commands found: has Typer's command tree changed?"
    assert sorted(commands - ROUTES.keys()) == [], "add an endpoint for each, and it to ROUTES"
    assert sorted(ROUTES.keys() - commands) == [], "no such commands"
    routes = set(openapi(paths)["paths"])
    assert sorted(set(ROUTES.values()) - routes) == []

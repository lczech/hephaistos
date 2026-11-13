from pathlib import Path
from typing import Annotated

import typer

from hephaistos.cli.output import (
    JsonOption,
    TimeFormatOption,
    print_fields,
    print_json,
    print_table,
    size_text,
    time_formatter,
)
from hephaistos.core import serialize
from hephaistos.core.config import TimeFormat
from hephaistos.core.db.sessions import read_session
from hephaistos.core.registry import machines
from hephaistos.core.registry.machines import LocalSetup
from hephaistos.core.registry.mounts import mounts_of
from hephaistos.core.serialize import HephaistosPathsJson, PathJson
from hephaistos.core.utils.ids import id_datetime
from hephaistos.core.utils.paths import Paths, short_path

app = typer.Typer(no_args_is_help=True, help="Machines: computers running hephaistos.")


def path_entries(found: HephaistosPathsJson) -> list[tuple[str, PathJson]]:
    """Where hephaistos keeps its files, each directory by its name."""
    return [
        ("code", found["code"]),
        ("config", found["config"]),
        ("data", found["data"]),
        ("logs", found["logs"]),
        ("app", found["desktop"]),  # not "desktop": About names the desktop environment so
    ]


def path_text(name: str, entry: PathJson, *, exists: bool | None = None) -> str:
    """A directory, with its size if given: `~/.local/share/hephaistos/… (1.1 MB)`.

    `exists` replaces what `entry` says, e.g. recorded when the Daemon started.
    """
    notes = [] if (entry["exists"] if exists is None else exists) else ["not there yet"]
    if (size := entry["size"]) is not None:
        # That of the logs counts the log files alone.
        notes.append(f"{size_text(size)} of logs" if name == "logs" else size_text(size))
    shown = short_path(Path(entry["path"]))
    return f"{shown} ({', '.join(notes)})" if notes else shown


def path_fields(found: HephaistosPathsJson) -> list[tuple[str, str]]:
    """Where hephaistos keeps its files, as fields: `config`, `~/.config/hephaistos`."""
    return [(name, path_text(name, entry)) for name, entry in path_entries(found)]


def _setup_fields(setup: LocalSetup) -> list[tuple[str, str]]:
    """This Machine's setup, as `show` prints it."""
    return [
        *path_fields(serialize.hephaistos_paths_json(setup.paths)),
        ("database", f"{setup.journal_mode.upper()} journal, on {setup.data_fstype}"),
        ("schema", str(setup.schema_version)),
    ]


@app.command("list")
def list_(*, as_json: JsonOption = False) -> None:
    """List the machines; `*` marks this one."""
    with read_session(Paths.from_environment()) as session:
        if as_json:
            print_json(serialize.machines_json(session))
            return
        found = [(machine, mounts_of(session, machine.id)) for machine in machines.listing(session)]
        this_id = session.machine_id
    print_table(
        ["", "name", "hostname", "chassis"],
        [
            [
                "*" if machine.id == this_id else "",
                machine.name,
                machine.hostname,
                machine.chassis or "-",
            ]
            for machine, _ in found
        ],
    )


@app.command()
def show(
    name: Annotated[
        str | None, typer.Argument(help="Name of the machine. Default: this one.")
    ] = None,
    *,
    time_format: TimeFormatOption = None,
    as_json: JsonOption = False,
) -> None:
    """Show a machine; for this one, also its setup."""
    paths = Paths.from_environment()
    with read_session(paths) as session:
        machine = machines.by_name(session, name) if name else machines.this(session)
        mounts = mounts_of(session, machine.id)
        this = machine.id == session.machine_id
        setup = machines.local_setup(session, paths) if this else None

    if as_json:
        print_json(serialize.machine_json(machine, mounts, this=this, setup=setup))
        return
    formatted = time_formatter(time_format, TimeFormat.FULL)
    print_fields(
        [
            ("name", machine.name),
            ("id", str(machine.id)),
            ("hostname", machine.hostname),
            ("chassis", machine.chassis or "-"),
            ("os machine id", machine.os_machine_id or "-"),
            ("created", formatted(id_datetime(machine.id))),
            ("this", "yes" if this else "no"),
            *(_setup_fields(setup) if setup else []),
            *(("mount", f"{mount.path}  {filesystem.name}") for mount, filesystem in mounts),
        ]
    )

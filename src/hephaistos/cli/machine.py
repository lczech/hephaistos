from typing import Annotated

import typer

from hephaistos.cli.output import (
    JsonOption,
    TimeFormatOption,
    print_fields,
    print_json,
    print_table,
    short_path,
    time_formatter,
)
from hephaistos.core.config import TimeFormat
from hephaistos.core.db.sessions import read_session
from hephaistos.core.registry import machines
from hephaistos.core.registry.filesystems import Filesystem
from hephaistos.core.registry.machines import LocalSetup, Machine
from hephaistos.core.registry.mounts import Mount, mounts_of
from hephaistos.core.utils.ids import id_datetime
from hephaistos.core.utils.paths import Paths

app = typer.Typer(no_args_is_help=True, help="Machines: computers running hephaistos.")


def machine_json(
    machine: Machine, mounts: list[tuple[Mount, Filesystem]], *, this: bool
) -> dict[str, object]:
    """A Machine with its mounts, for JSON output."""
    return {
        "id": str(machine.id),
        "name": machine.name,
        "hostname": machine.hostname,
        "os_machine_id": machine.os_machine_id,
        "created_at": id_datetime(machine.id).isoformat(),
        "this": this,
        "mounts": [
            {"path": str(mount.path), "filesystem": filesystem.name} for mount, filesystem in mounts
        ],
    }


def _setup_json(setup: LocalSetup) -> dict[str, object]:
    """This Machine's setup, for JSON output."""
    paths = setup.paths
    return {
        "config_file": str(paths.config_file),
        "data_dir": str(paths.data_dir),
        "state_dir": str(paths.state_dir),
        "database": str(paths.database),
        "journal_mode": setup.journal_mode,
        "data_fstype": setup.data_fstype,
        "schema_version": setup.schema_version,
    }


def _setup_fields(setup: LocalSetup) -> list[tuple[str, str]]:
    """This Machine's setup, as `show` prints it."""
    paths = setup.paths
    config_note = "" if paths.config_file.exists() else " (not present)"
    return [
        ("config", short_path(paths.config_file) + config_note),
        ("data", short_path(paths.data_dir)),
        ("logs", short_path(paths.state_dir)),
        ("database", f"{setup.journal_mode.upper()} journal, on {setup.data_fstype}"),
        ("schema", str(setup.schema_version)),
    ]


@app.command("list")
def list_(*, as_json: JsonOption = False) -> None:
    """List the Machines; `*` marks this one."""
    with read_session(Paths.from_environment()) as session:
        found = [(machine, mounts_of(session, machine.id)) for machine in machines.listing(session)]
        this_id = session.machine_id
    if as_json:
        print_json(
            [machine_json(machine, mounts, this=machine.id == this_id) for machine, mounts in found]
        )
        return
    print_table(
        ["", "name", "hostname"],
        [
            ["*" if machine.id == this_id else "", machine.name, machine.hostname]
            for machine, _ in found
        ],
    )


@app.command()
def show(
    name: Annotated[
        str | None, typer.Argument(help="Name of the Machine. Default: this one.")
    ] = None,
    *,
    time_format: TimeFormatOption = None,
    as_json: JsonOption = False,
) -> None:
    """Show a Machine; for this one, also its setup."""
    paths = Paths.from_environment()
    with read_session(paths) as session:
        machine = machines.by_name(session, name) if name else machines.this(session)
        mounts = mounts_of(session, machine.id)
        this = machine.id == session.machine_id
        setup = machines.local_setup(session, paths) if this else None

    if as_json:
        print_json(machine_json(machine, mounts, this=this) | (_setup_json(setup) if setup else {}))
        return
    formatted = time_formatter(time_format, TimeFormat.FULL)
    print_fields(
        [
            ("name", machine.name),
            ("id", str(machine.id)),
            ("hostname", machine.hostname),
            ("os machine id", machine.os_machine_id or "-"),
            ("created", formatted(id_datetime(machine.id))),
            ("this", "yes" if this else "no"),
            *(_setup_fields(setup) if setup else []),
            *(("mount", f"{mount.path}  {filesystem.name}") for mount, filesystem in mounts),
        ]
    )

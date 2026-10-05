import typer

from hephaistos.cli.output import JsonOption, full_time, print_fields, print_json, short_path
from hephaistos.core.db.sessions import read_session
from hephaistos.core.registry import machines
from hephaistos.core.utils.paths import Paths

app = typer.Typer(no_args_is_help=True, help="Machines: computers running hephaistos.")


@app.command()
def show(*, as_json: JsonOption = False) -> None:
    """Show this Machine and its setup."""
    paths = Paths.from_environment()
    with read_session(paths) as session:
        info = machines.details(session, paths)
    machine = info.machine
    config_note = "" if paths.config_file.exists() else " (not present)"

    if as_json:
        print_json(
            {
                "id": str(machine.id),
                "name": machine.name,
                "hostname": machine.hostname,
                "os_machine_id": machine.os_machine_id,
                "created": info.created.isoformat(),
                "config_file": str(paths.config_file),
                "data_dir": str(paths.data_dir),
                "state_dir": str(paths.state_dir),
                "database": str(paths.database),
                "journal_mode": info.journal_mode,
                "data_fstype": info.data_fstype,
                "schema_version": info.schema_version,
                "mounts": [
                    {"path": str(mount.path), "filesystem": filesystem.name}
                    for mount, filesystem in info.mounts
                ],
            }
        )
        return

    print_fields(
        [
            ("name", machine.name),
            ("id", str(machine.id)),
            ("hostname", machine.hostname),
            ("os machine id", machine.os_machine_id or "-"),
            ("created", full_time(info.created)),
            ("config", short_path(paths.config_file) + config_note),
            ("data", short_path(paths.data_dir)),
            ("logs", short_path(paths.state_dir)),
            ("database", f"{info.journal_mode.upper()} journal, on {info.data_fstype}"),
            ("schema", str(info.schema_version)),
            *(("mount", f"{mount.path}  {filesystem.name}") for mount, filesystem in info.mounts),
        ]
    )

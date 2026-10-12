"""`hephaistos config`: the settings in effect on this Machine, and the shipped defaults."""

import socket
from collections.abc import Sequence
from pathlib import Path
from typing import Annotated

import typer

from hephaistos.cli.output import JsonOption, print_json, print_rows, short_path
from hephaistos.core import config, views
from hephaistos.core.config import Layer
from hephaistos.core.utils.paths import Paths

app = typer.Typer(
    no_args_is_help=True,
    help="Settings: the shipped defaults, overridden by config files and environment variables.",
)


def _keys(chosen: str | None) -> list[str]:
    """The settings a key or a section names; all of them without one."""
    if chosen is None:
        return list(config.KEYS)
    keys = [key for key in config.KEYS if key == chosen or key.startswith(f"{chosen}.")]
    if not keys:
        raise typer.BadParameter(config.unknown_text(chosen), param_hint="KEY")
    return keys


def _source_text(source: str) -> str:
    """A file by its name, as all are in one directory; a variable or `default` as it is."""
    return Path(source).name


def _sources_rows(directory: Path, hostname: str, found: Sequence[Layer]) -> list[tuple[str, str]]:
    """Where settings come from, in the order they apply, then what is ours but unused."""
    rows = [
        (layer.source if layer.path is None else short_path(layer.path), layer.state)
        for layer in found
    ]
    rows += [
        (short_path(path), "other host (unused here)")
        for path in config.other_hosts_files(directory, hostname)
    ]
    rows += [
        (name, f"unknown (did you mean {close}?)" if close else "unknown")
        for name, close in config.unknown_variables().items()
    ]
    return rows


@app.command()
def show(
    key: Annotated[
        str | None,
        typer.Argument(
            metavar="KEY", help="One setting, e.g. git.timeout, or a section, e.g. git."
        ),
    ] = None,
    *,
    as_json: JsonOption = False,
) -> None:
    """Show the settings in effect on this Machine, and where each value comes from.

    One setting shows just its value. A broken config file or variable is left out, and its
    error shown; the command then fails. As JSON, each setting also comes with the value this
    process applies.
    """
    keys = _keys(key)
    directory = Paths.from_environment().config_dir
    hostname = socket.gethostname()
    found = config.layers(directory, hostname)
    loaded = config.merged(found)
    if as_json:
        if key is not None:
            raise typer.BadParameter("--json shows all settings; leave out KEY", param_hint="KEY")
        print_json(views.config_json(directory, hostname))
    elif key in config.KEYS:
        typer.echo(config.setting_text(loaded.values[key]))
    else:
        print_rows(
            [
                (k, config.setting_text(loaded.values[k]), _source_text(loaded.sources[k]))
                for k in keys
            ]
        )
        typer.echo(f"\nHost: {hostname}")
        print_rows(_sources_rows(directory, hostname, found))
    errors = [layer.error for layer in found if layer.error is not None]
    for error in errors:
        typer.echo(f"error: {error}", err=True)
    if errors:
        raise typer.Exit(1)


@app.command()
def defaults() -> None:
    """Show the shipped defaults.toml: every setting with its default, documented."""
    typer.echo(config.DEFAULTS_TEXT, nl=False)

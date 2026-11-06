"""`hephaistos files`: what a Directory holds, as the GUI's Explorer asks for it."""

from pathlib import Path
from typing import Annotated

import typer

from hephaistos.cli.output import (
    JsonOption,
    TimeFormatOption,
    print_json,
    print_table,
    time_formatter,
)
from hephaistos.core import config, serialize
from hephaistos.core.config import TimeFormat
from hephaistos.core.utils import files
from hephaistos.core.utils.files import FIELDS, Entry, Field
from hephaistos.core.utils.paths import absolute
from hephaistos.core.utils.text import number_text, size_text


def _fields(value: str | None) -> frozenset[Field]:
    """The fields `--fields` names, comma-separated."""
    if not value:
        return frozenset()
    names = [name.strip() for name in value.split(",") if name.strip()]
    unknown = [name for name in names if name not in FIELDS]
    if unknown:
        known = ", ".join(FIELDS)
        raise typer.BadParameter(f"unknown field {unknown[0]!r}: choose from {known}")
    return frozenset(name for name in FIELDS if name in names)


FieldsOption = Annotated[
    str | None,
    typer.Option(
        "--fields",
        "-f",
        help="More than names and kinds, comma-separated: size, modified, git.",
        show_default=False,
    ),
]


def _name_text(entry: Entry) -> str:
    """An entry's name as `ls -F` marks it: `src/`, `link -> target`."""
    if entry.kind == "directory":
        return f"{entry.name}/"
    if entry.kind == "symlink":
        broken = "" if entry.to else " (broken)"
        return f"{entry.name} -> {entry.target}{broken}"
    return entry.name


def _git_text(entry: Entry) -> str:
    """What git says of an entry: its letter, `!` if ignored, `*` for changes below it."""
    if entry.ignored:
        return "!"
    return entry.status or ("*" if entry.changed else "")


def files_(
    path: Annotated[
        Path | None,
        typer.Argument(help="The directory; the current one if not given.", show_default=False),
    ] = None,
    *,
    fields: FieldsOption = None,
    time_format: TimeFormatOption = None,
    as_json: JsonOption = False,
) -> None:
    """List what a directory holds, by name, not what is below its directories.

    Hidden entries are listed too. With `--fields git`, git's letter for each, as in its status:
    `M` modified, `A` added, `?` untracked, `!` ignored, `*` a directory with changes below it.
    """
    chosen = _fields(fields)
    found = files.listing(
        absolute(path or Path()),
        chosen,
        max_entries=config.settings().files.max_entries,
    )
    if as_json:
        print_json(serialize.files_json(found))
        return
    shown: list[Field] = [field for field in FIELDS if field in chosen]
    formatted = time_formatter(time_format, TimeFormat.RELATIVE)

    def cell(entry: Entry, field: Field) -> str:
        if field == "size":
            return "" if entry.size is None else size_text(entry.size)
        if field == "modified":
            return "" if entry.modified is None else formatted(entry.modified)
        return _git_text(entry)

    if found.entries:
        print_table(
            ["name", *shown],
            [
                [_name_text(entry), *(cell(entry, field) for field in shown)]
                for entry in found.entries
            ],
        )
    else:
        typer.echo("Empty.")
    left = found.count - len(found.entries)
    if left > 0:
        typer.echo(
            f"\n{number_text(left, 'more entry', 'more entries')} not listed, as the setting"
            f" files.max_entries allows {found.count - left:,}"
        )

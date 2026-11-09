"""`hephaistos files`: what a Directory holds, and what is below it, found by name.

As the GUI's Explorer asks for them.
"""

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
from hephaistos.core.utils import file_search, files
from hephaistos.core.utils.files import FIELDS, Entry, Field
from hephaistos.core.utils.paths import absolute
from hephaistos.core.utils.text import number_text, size_text

app = typer.Typer(
    no_args_is_help=True, help="What a directory holds, and finding files below it by name."
)


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
    """What git says of an entry, as `git status --short` does, or `*` for changes below it."""
    if entry.ignored:
        return "!!"
    if entry.index or entry.worktree:
        return f"{entry.index or ' '}{entry.worktree or ' '}"
    return "*" if entry.changed else ""


DirectoryArgument = Annotated[
    Path | None,
    typer.Argument(help="The directory; the current one if not given.", show_default=False),
]


@app.command("list")
def list_(
    path: DirectoryArgument = None,
    *,
    fields: FieldsOption = None,
    time_format: TimeFormatOption = None,
    as_json: JsonOption = False,
) -> None:
    """List what a directory holds, by name, not what is below its directories.

    Hidden entries are listed too. With `--fields git`, git's letters for each, as `git status
    --short` shows them, staged then not: `M` modified, `A` added, `??` untracked, `!!` ignored;
    `*` marks a directory with changes below it.
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
    formatted = time_formatter(time_format, TimeFormat.RECENT)

    def cell(entry: Entry, field: Field) -> str:
        if field == "size":
            if entry.items is not None:
                return number_text(entry.items, "item")
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


HiddenOption = Annotated[
    bool,
    typer.Option(
        "--hidden/--no-hidden",
        help="Hidden ones too, whose names start with `.`, as `list` and the Explorer show them.",
    ),
]
IgnoredOption = Annotated[
    bool, typer.Option("--ignored", help="Those git ignores too, in working trees.")
]


def _paths(path: Path | None, *, hidden: bool, ignored: bool) -> file_search.Paths:
    """The paths below the directory, as the settings allow."""
    settings = config.settings().files
    return file_search.paths(
        absolute(path or Path()),
        hidden=hidden,
        ignored=ignored,
        max_paths=settings.max_paths,
        seconds=settings.search_seconds,
    )


def _print_paths(found: file_search.Paths, shown: list[str], *, as_json: bool) -> None:
    """Paths, one per line, then why there may be more."""
    if as_json:
        print_json(serialize.paths_json(found, shown))
        return
    for path in shown:
        typer.echo(path)
    if found.stopped == "max_paths":
        typer.echo(
            f"\nStopped at {found.limit:,.0f} paths, as the setting files.max_paths allows;"
            " search a directory further in."
        )
    elif found.stopped == "time":
        typer.echo(
            f"\nStopped after {found.limit:g} s, as the setting files.search_seconds allows;"
            " search a directory further in."
        )


@app.command()
def search(  # noqa: PLR0913 - one option per way of matching
    text: Annotated[str, typer.Argument(help="What names have; with a `/`, what paths have.")],
    path: DirectoryArgument = None,
    *,
    case: Annotated[bool, typer.Option("--case", help="Match case.")] = False,
    word: Annotated[bool, typer.Option("--word", help="Match whole words.")] = False,
    regex: Annotated[
        bool, typer.Option("--regex", help="Take TEXT as a regular expression, Python's.")
    ] = False,
    hidden: HiddenOption = True,
    ignored: IgnoredOption = False,
    as_json: JsonOption = False,
) -> None:
    """Find files and folders below a directory by name, as typed, case ignored.

    TEXT with a `/` matches paths below the directory instead: `explorer/col`. Paths show below
    the directory, a folder's ending in `/`. Inside working trees, what git ignores is left out,
    and `.git` folders always are; symlinks are not followed.
    """
    found = _paths(path, hidden=hidden, ignored=ignored)
    shown = file_search.matching(found, text, case=case, word=word, regex=regex)
    _print_paths(found, shown, as_json=as_json)


@app.command()
def paths(
    path: DirectoryArgument = None,
    *,
    hidden: HiddenOption = True,
    ignored: IgnoredOption = False,
    as_json: JsonOption = False,
) -> None:
    """List every path below a directory, as `search` looks through them, unmatched.

    A folder's ends in `/`. Inside working trees, what git ignores is left out, and `.git`
    folders always are; symlinks are not followed.
    """
    found = _paths(path, hidden=hidden, ignored=ignored)
    _print_paths(found, list(found.paths), as_json=as_json)

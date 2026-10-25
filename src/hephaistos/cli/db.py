import json
import uuid
from collections.abc import Callable, Sequence
from datetime import datetime
from typing import Annotated

import typer

from hephaistos.cli.output import (
    JsonOption,
    LimitOption,
    ReverseOption,
    TimeFormatOption,
    chosen_time_format,
    full_time,
    print_fields,
    print_json,
    print_table,
    time_formatter,
)
from hephaistos.core import serialize
from hephaistos.core.config import TimeFormat
from hephaistos.core.db import raw
from hephaistos.core.db.sessions import read_session
from hephaistos.core.db.tables import Table
from hephaistos.core.utils.ids import Timestamp, short_id
from hephaistos.core.utils.paths import Paths

app = typer.Typer(no_args_is_help=True, help="This machine's database, as stored: for debugging.")

type ValueText = Callable[[object], str]


def _warn(warnings: Sequence[str]) -> None:
    """Prints what's unusual about the database on stderr."""
    for warning in warnings:
        typer.echo(f"warning: {warning}", err=True)


def value_text(time_format: TimeFormat | None, *, short_ids: bool = False) -> ValueText:
    """Shows decoded values: times as `--time-format` says, to the millisecond in `full`."""
    chosen = chosen_time_format(time_format, TimeFormat.FULL)
    formatted = time_formatter(chosen, chosen)

    def precise(value: datetime) -> str:
        """In `full`, with milliseconds; else as chosen."""
        if chosen is not TimeFormat.FULL:
            return formatted(value)
        return f"{full_time(value)}.{value.microsecond // 1000:03d}"

    def text(value: object) -> str:
        match value:
            case None:
                return "NULL"
            case uuid.UUID():
                return short_id(value) if short_ids else str(value)
            case Timestamp():
                return precise(value.datetime) + (
                    f" #{value.counter}" if chosen is TimeFormat.FULL else ""
                )
            case datetime():
                return precise(value)
            case dict() | list():
                return json.dumps(value)
            case _:
                return str(value).replace("\n", "\\n")

    return text


@app.command()
def tables(*, time_format: TimeFormatOption = None, as_json: JsonOption = False) -> None:
    """List the database's tables, with their row counts and latest changes."""
    with read_session(Paths.from_environment(), check_schema=False) as session:
        if as_json:
            print_json(serialize.tables_json(session))
            return
        found = raw.tables(session)
        _warn(serialize.db_warnings(session, found))
    text = value_text(time_format)
    print_table(
        ["table", "category", "rows", "latest"],
        [
            [
                table.name,
                table.category or "unknown",
                "missing" if table.rows is None else str(table.rows),
                "-" if table.latest is None else text(table.latest),
            ]
            for table in found
        ],
    )


def _complete_table(incomplete: str) -> list[str]:
    """This version's tables starting with what was typed."""
    return [table.value for table in Table if table.startswith(incomplete)]


def _print_blocks(columns: Sequence[str], rows: Sequence[Sequence[str]]) -> None:
    """Prints each row as `column  value` lines, rows separated by a blank line."""
    for index, row in enumerate(rows):
        if index:
            typer.echo()
        print_fields(list(zip(columns, row, strict=True)))


@app.command()
def dump(  # noqa: PLR0913 - one option per choice
    table: Annotated[
        str,
        typer.Argument(help="The table, as `db tables` lists it.", autocompletion=_complete_table),
    ],
    *,
    column: Annotated[
        list[str] | None,
        typer.Option("--column", "-c", help="Only this column. Repeat for several, in order."),
    ] = None,
    as_table: Annotated[
        bool | None,
        typer.Option(
            "--table/--blocks",
            help="One line per row, or one line per value. Default: lines per value for all"
            " columns, one line per row for chosen ones.",
        ),
    ] = None,
    short_ids: Annotated[
        bool, typer.Option("--short-ids", help="Show IDs by their end, as lists do.")
    ] = False,
    limit: LimitOption = 20,
    offset: Annotated[
        int,
        typer.Option("--offset", min=0, help="Skip this many newest first, for the next page."),
    ] = 0,
    reverse: ReverseOption = False,
    time_format: TimeFormatOption = None,
    as_json: JsonOption = False,
) -> None:
    """Show a table's newest rows, oldest first, with IDs, times and JSON decoded."""
    with read_session(Paths.from_environment(), check_schema=False) as session:
        if as_json:
            listed = serialize.rows_json(session, table, column or (), limit or None, offset)
            if not reverse:
                listed["rows"].reverse()
            print_json(listed)
            return
        found = raw.rows(session, table, column or (), limit or None, offset)
        _warn(serialize.db_warnings(session))
    text = value_text(time_format, short_ids=short_ids)
    values = found.values if reverse else found.values[::-1]
    rows = [[text(value) for value in row] for row in values]
    if not rows:
        typer.echo("No rows")
    elif as_table if as_table is not None else bool(column):
        print_table(found.columns, rows)
    else:
        _print_blocks(found.columns, rows)

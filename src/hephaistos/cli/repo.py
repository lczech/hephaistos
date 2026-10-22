from typing import Annotated

import typer

from hephaistos.cli import terminal
from hephaistos.cli.clone import active_text, branch_text, status_text, worktree_lines
from hephaistos.cli.output import (
    JsonOption,
    TimeFormatOption,
    print_fields,
    print_json,
    print_table,
    time_formatter,
)
from hephaistos.core import serialize
from hephaistos.core.config import TimeFormat
from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.registry import clones, repositories
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import id_datetime
from hephaistos.core.utils.paths import Paths, short_path
from hephaistos.core.utils.text import number_text

app = typer.Typer(no_args_is_help=True, help="Repositories: projects under git, with their Clones.")

NameArgument = Annotated[str, typer.Argument(help="Name of the Repository.")]


@app.command("list")
def list_(*, time_format: TimeFormatOption = None, as_json: JsonOption = False) -> None:
    """List the Repositories."""
    with read_session(Paths.from_environment()) as session:
        if as_json:
            print_json(serialize.repositories_json(session))
            return
        summaries = repositories.summaries(session)
    formatted = time_formatter(time_format, TimeFormat.RELATIVE)
    print_table(
        ["name", "clones", "active", "remote"],
        [
            [
                summary.repository.name,
                str(summary.clones),
                active_text(summary.active_at, formatted),
                ", ".join(summary.remotes) or "-",
            ]
            for summary in summaries
        ],
    )


@app.command()
def show(
    name: NameArgument, *, time_format: TimeFormatOption = None, as_json: JsonOption = False
) -> None:
    """Show a Repository with its remotes and Clones."""
    with read_session(Paths.from_environment()) as session:
        repository = repositories.by_name(session, name)
        if as_json:
            print_json(serialize.repositories_json(session, repository.id)[0])
            return
        [summary] = repositories.summaries(session, repository.id)
        its_clones = clones.details(session, repository_id=repository.id)
    formatted = time_formatter(time_format, TimeFormat.FULL)
    print_fields(
        [
            ("name", repository.name),
            ("id", str(repository.id)),
            ("created", formatted(id_datetime(repository.id))),
            ("active", active_text(summary.active_at, formatted)),
            *(("remote", remote) for remote in summary.remotes),
            *(
                line
                for details in its_clones
                for line in [
                    (
                        "clone",
                        "  ".join(
                            [
                                short_path(details.clone.display_path),
                                branch_text(details.state),
                                status_text(details.state),
                                details.filesystem.name,
                            ]
                        ),
                    ),
                    *worktree_lines(details),
                ]
            ),
        ]
    )


@app.command()
def register(name: NameArgument) -> None:
    """Register a Repository; then register its Clones with `clone register`."""
    with write_session(Paths.from_environment()) as session:
        repository = repositories.register(session, name)
    typer.echo(f"Registered Repository {repository.name}")


@app.command()
def rename(
    name: NameArgument,
    new_name: Annotated[str, typer.Argument(help="The new name.")],
) -> None:
    """Rename a Repository."""
    with write_session(Paths.from_environment()) as session:
        repositories.rename(session, name, new_name)
    typer.echo(f"Renamed Repository {name} to {new_name}")


@app.command()
def unregister(
    name: NameArgument,
    *,
    with_clones: Annotated[
        bool, typer.Option("--clones", help="Also unregister its Clones, on every Machine.")
    ] = False,
    yes: Annotated[
        bool, typer.Option("--yes", help="Unregister its Clones without asking.")
    ] = False,
) -> None:
    """Unregister a Repository; its Clones' files stay untouched."""
    paths = Paths.from_environment()
    with read_session(paths) as session:
        repository = repositories.by_name(session, name)
        its_clones = clones.details(session, repository_id=repository.id)
    counted = number_text(len(its_clones), "Clone")
    listed = "\n".join(
        f"  {short_path(details.clone.display_path)}  {details.filesystem.name}"
        for details in its_clones
    )
    if its_clones and not with_clones:
        them = "it" if len(its_clones) == 1 else "them"
        raise HephaistosError(
            f"{name} still has {counted}:\n{listed}\nunregister {them} first, or give --clones"
        )
    if its_clones and not yes:
        typer.echo(f"{name} has {counted}:\n{listed}")
        terminal.confirm(
            f"Unregister {name} and its {counted}?", default=False, action="unregister them"
        )
    with write_session(paths) as session:
        clones.unregister_all(session, repository, [details.clone.id for details in its_clones])
        repositories.unregister(session, name)
    with_text = f" and its {counted}" if its_clones else ""
    typer.echo(f"Unregistered Repository {name}{with_text} (files untouched)")

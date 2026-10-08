from collections import Counter
from pathlib import Path
from typing import Annotated

import typer

from hephaistos.cli import terminal
from hephaistos.cli.clone import ImportHistoryOption
from hephaistos.cli.output import number_text, print_table, short_path
from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.observers import clones as observer
from hephaistos.core.registry import scan as scanning
from hephaistos.core.registry.scan import Action, Planned
from hephaistos.core.utils.paths import Paths, absolute

#: How the summary line counts what plans leave out.
_QUIET = {
    Action.KNOWN: ("known", "known"),
    Action.WORKTREE: ("Worktree of a Clone above", "Worktrees of Clones above"),
    Action.UNREADABLE: ("unreadable directory", "unreadable directories"),
}


def _note_text(row: Planned) -> str:
    """A row's note, with the path it names."""
    return " ".join(filter(None, [row.note, row.about and short_path(row.about)]))


def _print_plan(planned: list[Planned], *, verbose: bool) -> None:
    """Prints the plan's table, the commands for the skipped ones, and what was left out."""
    shown = [row for row in planned if verbose or not row.action.is_quiet]
    if shown:
        print_table(
            ["path", "action", "repository", "note"],
            [
                [short_path(row.path), row.action, row.repository or "-", _note_text(row)]
                for row in shown
            ],
        )
    fixes = [command for row in planned for command in row.fix]
    if fixes:
        typer.echo("\nTo add the skipped ones by hand:")
        for command in fixes:
            typer.echo(f"  {command}")
    counts = Counter(row.action for row in planned if row.action.is_quiet)
    if counts and not verbose:
        left_out = [
            number_text(counts[action], *_QUIET[action]) for action in _QUIET if counts[action]
        ]
        gap = "\n" if shown else ""
        typer.echo(f"{gap}Not listed: {', '.join(left_out)} (-v lists them)")


def _changes_text(counts: Counter[Action], *, done: bool) -> str:
    """What adding a plan does, e.g. `Add 5 Clones (2 new Repositories)`; past tense if `done`."""
    adding, new, observing = (
        counts[Action.JOIN] + counts[Action.NEW],
        counts[Action.NEW],
        counts[Action.OBSERVE],
    )
    parts: list[str] = []
    if adding:
        text = f"{'added' if done else 'add'} {number_text(adding, 'Clone')}"
        if new:
            text += f" ({number_text(new, 'new Repository', 'new Repositories')})"
        parts.append(text)
    if observing:
        parts.append(
            f"{'observed' if done else 'observe'} {number_text(observing, 'new Worktree')}"
        )
    text = ", and ".join(parts)
    return text[0].upper() + text[1:]


def scan(
    directory: Annotated[
        Path, typer.Argument(help="Where to search. Default: the current directory.")
    ] = Path(),
    *,
    depth: Annotated[
        int, typer.Option("--depth", "-d", min=0, help="How many directory levels down.")
    ] = scanning.DEPTH,
    verbose: Annotated[
        bool,
        typer.Option("--verbose", "-v", help="Also list what needs nothing: known ones, and more."),
    ] = False,
    yes: Annotated[bool, typer.Option("--yes", help="Add without asking.")] = False,
    import_history: ImportHistoryOption = False,
) -> None:
    """Find the git clones in a directory, and add them, with new Repositories where needed.

    Stops at clones, without searching inside them, and skips hidden directories. A clone that
    matches several Repositories, or whose new Repository's name is taken, is skipped.
    """
    paths = Paths.from_environment()
    with read_session(paths) as session:
        planned = scanning.plan(session, directory, depth)
    _print_plan(planned, verbose=verbose)
    if all(row.action is Action.UNREADABLE for row in planned):
        typer.echo(f"No git clones found under {short_path(absolute(directory))} (depth {depth})")
        return

    counts = Counter(row.action for row in planned)
    if not any(counts[action] for action in (Action.JOIN, Action.NEW, Action.OBSERVE)):
        typer.echo("Nothing to add")
        return
    if not yes:
        terminal.confirm(f"{_changes_text(counts, done=False)}?", default=True, action="add these")

    with write_session(paths) as session:
        added = scanning.add(session, planned, import_history=import_history)
    # Observing right away finds their Worktrees and starts their git activity from now.
    observing = {row.clone_id for row in planned if row.clone_id is not None}
    result = observer.observe(paths, {*added, *observing})
    done = _changes_text(counts, done=True)
    if import_history:
        done += f"; imported {number_text(len(result.events), 'Event')} of their history"
    typer.echo(done)

from pathlib import Path
from typing import Annotated, Literal

import typer

from hephaistos.cli.event import print_events
from hephaistos.cli.output import JsonOption, TimeFormatOption, number_text
from hephaistos.core.db.sessions import read_session
from hephaistos.core.observers import clones as observer
from hephaistos.core.registry import clones
from hephaistos.core.utils.paths import Paths

Target = Literal["clones"]


def observe(
    target: Annotated[
        Target | None, typer.Argument(help="What to observe. Default: everything.")
    ] = None,
    *,
    clone: Annotated[
        list[Path] | None,
        typer.Option(
            help="Only the Clone that this path lies in, or whose Worktree. Repeat for several."
        ),
    ] = None,
    time_format: TimeFormatOption = None,
    as_json: JsonOption = False,
) -> None:
    """Observe this Machine's Clones and their Worktrees now, and show the Events this records."""
    del target  # Clones are all there is to observe so far.
    paths = Paths.from_environment()
    clone_ids = None
    if clone:
        with read_session(paths) as session:
            clone_ids = {clones.find_unobserved(session, path).clone.id for path in clone}
    result = observer.observe(paths, clone_ids)
    with read_session(paths) as session:
        if as_json or result.events:
            print_events(session, result.events, time_format=time_format, as_json=as_json)
    if as_json:
        return
    if not result.events:
        observed = number_text(result.observed, "Clone")
        if result.worktrees:
            observed += f" and {number_text(result.worktrees, 'Worktree')}"
        typer.echo(f"No changes ({observed} observed)")
    if result.skipped:
        skipped = number_text(result.skipped, "Clone")
        typer.echo(f"{skipped} skipped: observed by another process meanwhile")

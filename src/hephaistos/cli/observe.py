from pathlib import Path
from typing import Annotated, Literal

import typer

from hephaistos.cli.event import print_events
from hephaistos.cli.output import TimeFormatOption
from hephaistos.core.db.sessions import read_session
from hephaistos.core.observers import clones as observer
from hephaistos.core.registry import clones
from hephaistos.core.utils.paths import Paths
from hephaistos.core.utils.text import number_text

Target = Literal["clones"]


def observe(
    target: Annotated[
        Target | None, typer.Argument(help="What to observe. Default: everything.")
    ] = None,
    *,
    clone: Annotated[
        list[Path] | None,
        typer.Option(
            help="Only the clone that this path lies in, or whose worktree. Repeat for several."
        ),
    ] = None,
    time_format: TimeFormatOption = None,
) -> None:
    """Observe this machine's clones and their worktrees now, and show the events this records."""
    del target  # Clones are all there is to observe so far.
    paths = Paths.from_environment()
    clone_ids = None
    if clone:
        with read_session(paths) as session:
            clone_ids = {clones.find_unobserved(session, path).clone.id for path in clone}
    result = observer.observe(paths, clone_ids)
    if result.events:
        with read_session(paths) as session:
            print_events(session, result.events, time_format=time_format)
    else:
        observed = number_text(result.observed, "clone")
        if result.worktrees:
            observed += f" and {number_text(result.worktrees, 'worktree')}"
        typer.echo(f"No changes ({observed} observed)")
    if result.skipped:
        skipped = number_text(result.skipped, "clone")
        typer.echo(f"{skipped} skipped: observed by another process meanwhile")

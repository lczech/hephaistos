from pathlib import Path
from typing import Annotated, Literal

import typer

from hephaistos.cli.event import print_events
from hephaistos.cli.output import JsonOption, TimeFormatOption
from hephaistos.core.db.sessions import read_session
from hephaistos.core.observers import clones as observer
from hephaistos.core.registry import clones
from hephaistos.core.utils.paths import Paths

Target = Literal["clones"]


def _clones_text(count: int) -> str:
    return f"{count} Clone{'' if count == 1 else 's'}"


def observe(
    target: Annotated[
        Target | None, typer.Argument(help="What to observe. Default: everything.")
    ] = None,
    *,
    clone: Annotated[
        list[Path] | None,
        typer.Option(help="Only the Clone that this path lies in. Repeat for several."),
    ] = None,
    time_format: TimeFormatOption = None,
    as_json: JsonOption = False,
) -> None:
    """Observe this Machine's Clones now, and show the Events this records."""
    del target  # Clones are all there is to observe so far.
    paths = Paths.from_environment()
    clone_ids = None
    if clone:
        with read_session(paths) as session:
            clone_ids = {clones.find(session, path).clone.id for path in clone}
    result = observer.observe(paths, clone_ids)
    with read_session(paths) as session:
        if as_json or result.events:
            print_events(session, result.events, time_format=time_format, as_json=as_json)
    if as_json:
        return
    if not result.events:
        typer.echo(f"No changes ({_clones_text(result.observed)} observed)")
    if result.skipped:
        typer.echo(f"{_clones_text(result.skipped)} skipped: observed by another process meanwhile")

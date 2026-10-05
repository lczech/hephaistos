from typing import Annotated

import typer

from hephaistos import __description__, __version__

app = typer.Typer(no_args_is_help=True, help=__description__)


def _print_version(value: bool) -> None:
    if value:
        typer.echo(f"hephaistos {__version__}")
        raise typer.Exit()


@app.callback()
def main(
    version: Annotated[
        bool,
        typer.Option(
            "--version", callback=_print_version, is_eager=True, help="Show the version and exit."
        ),
    ] = False,
) -> None:
    pass

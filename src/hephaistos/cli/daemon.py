"""`hephaistos daemon`: the background process that keeps this Machine's State fresh."""

import base64
from typing import Annotated

import typer

from hephaistos.core.utils.paths import Paths

VERSE = "RGVtb25zIHJ1biB3aGVuIGEgZ29vZCBtYW4gZ29lcyB0byB3YXIsCk5pZ2h0IHdpbGwgZmFsbCBhbmQgZHJvd24gdGhlIHN1biwKV2hlbiBhIGdvb2QgbWFuIGdvZXMgdG8gd2FyLgoKRnJpZW5kc2hpcCBkaWVzIGFuZCB0cnVlIGxvdmUgbGllcywKTmlnaHQgd2lsbCBmYWxsLCBhbmQgdGhlIGRhcmsgd2lsbCByaXNlLApXaGVuIGEgZ29vZCBtYW4gZ29lcyB0byB3YXIuCgpEZW1vbnMgcnVuLCBidXQgY291bnQgdGhlIGNvc3Q7ClRoZSBiYXR0bGUncyB3b24sIGJ1dCB0aGUgY2hpbGQgaXMgbG9zdC4="  # noqa: E501 - one encoded verse

app = typer.Typer(
    no_args_is_help=True,
    help="The Daemon: observes this Machine in the background.",
)


@app.command()
def run(
    *,
    doctor_who: Annotated[bool, typer.Option("--doctor-who", hidden=True)] = False,
) -> None:
    """Run the Daemon in the foreground, until stopped (Ctrl+C or SIGTERM).

    It runs the parts its settings enable: the Watcher observes this Machine's Clones every
    watcher.interval seconds, with git at low priority. One Daemon runs per Machine.
    """
    if doctor_who:
        typer.echo(base64.b64decode(VERSE).decode())
        return
    from hephaistos.daemon import main as daemon  # noqa: PLC0415 - only this command needs it

    daemon.run(Paths.from_environment(), lambda text: typer.echo(text, err=True))

"""`hephaistos desktop`: the Desktop, this Machine's GUI in a window of its own."""

import os
import shlex
import subprocess

import typer

from hephaistos.cli import terminal
from hephaistos.cli.daemon import executable
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths, own_checkout, private_directory, short_path
from hephaistos.desktop import apparmor, launch

app = typer.Typer(
    no_args_is_help=True, help="The Desktop: this Machine's GUI in a window of its own."
)


@app.command("open")
def open_desktop() -> None:
    """Open the Desktop, or bring the open one to the front; it starts the Daemon if needed."""
    desktop = launch.find(own_checkout())
    if apparmor.needed() and not apparmor.is_installed(desktop.electron):
        raise HephaistosError(
            "Electron's sandbox needs an AppArmor profile on this Machine:"
            " run `hephaistos desktop install`"
        )
    pid = launch.open_desktop(desktop, Paths.from_environment(), executable(), os.environ)
    typer.echo(
        "The Desktop was open; it comes to the front" if pid is None else "Opened the Desktop"
    )


@app.command()
def install() -> None:
    """Let the Desktop run on this Machine: install the AppArmor profile its sandbox needs.

    Ubuntu lets only programs with such a profile use Chromium's sandbox. Installing it takes
    root: the commands are shown, and run with sudo if you agree. Again after moving the checkout.
    """
    desktop = launch.find(own_checkout())
    if not apparmor.needed():
        typer.echo("This Machine needs no AppArmor profile for the Desktop")
        return
    if apparmor.is_installed(desktop.electron):
        typer.echo(f"Already installed: {apparmor.INSTALLED}")
        return
    source = private_directory(Paths.from_environment().state_dir) / f"{apparmor.NAME}.apparmor"
    source.write_text(apparmor.profile_text(desktop.electron))
    typer.echo(
        f"Electron's sandbox needs an AppArmor profile on this Machine; {short_path(source)}"
        " has it. Installing and loading it takes root:"
    )
    for command in apparmor.commands(source):
        typer.echo(f"  sudo {shlex.join(command)}")
    if not terminal.interactive() or not typer.confirm("Run them with sudo now?", default=False):
        typer.echo("Run them, then `hephaistos desktop open`")
        return
    # -k: asks for the password, and keeps no permission for later sudo calls.
    sudo = ["sudo", "-k", "sh", "-c", apparmor.script(source)]
    done = subprocess.run(sudo, check=False)  # noqa: S603 - the user's sudo, our commands
    if done.returncode != 0:
        raise HephaistosError(f"sudo failed (exit code {done.returncode}); nothing changed")
    typer.echo(f"Installed {apparmor.INSTALLED}")

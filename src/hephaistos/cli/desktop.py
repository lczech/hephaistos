"""`hephaistos desktop`: the Desktop, this Machine's GUI in a window of its own."""

import os
import shlex
import subprocess

import typer

from hephaistos.cli import terminal
from hephaistos.cli.daemon import executable
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths, own_checkout, private_directory, short_path
from hephaistos.desktop import apparmor, entry, launch

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


def _as_root(commands: list[list[str]], declined: str) -> bool:
    """Shows commands that need root and runs them with sudo if the user agrees.

    Returns whether they ran; if not, says `declined`.
    """
    for command in commands:
        typer.echo(f"  sudo {shlex.join(command)}")
    if not terminal.interactive() or not typer.confirm("Run them with sudo now?", default=False):
        typer.echo(declined)
        return False
    # -k: asks for the password, and keeps no permission for later sudo calls.
    sudo = ["sudo", "-k", "sh", "-c", apparmor.script(commands)]
    done = subprocess.run(sudo, check=False)  # noqa: S603 - the user's sudo, our commands
    if done.returncode != 0:
        raise HephaistosError(f"sudo failed (exit code {done.returncode}); nothing changed")
    return True


@app.command()
def install() -> None:
    """Install the Desktop on this Machine: its launcher entry and icon, and what it needs.

    The entry runs this hephaistos, by the path it was run as, with this shell's HEPHAISTOS_HOME
    and XDG directories. On Ubuntu, Chromium's sandbox also needs an AppArmor profile, which
    takes root: the commands are shown, and run with sudo if you agree. Again after moving the
    checkout.
    """
    desktop = launch.located(own_checkout())
    files = entry.Files.from_environment(os.environ)
    text = entry.entry_text(executable(), os.environ)
    changed = entry.install(files, text, desktop.checkout / entry.ICON)
    typer.echo(f"{'Installed' if changed else 'Already installed'}: {short_path(files.entry)}")
    if not apparmor.needed():
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
    if _as_root(apparmor.commands(source), "Run them, then `hephaistos desktop open`"):
        typer.echo(f"Installed {apparmor.INSTALLED}")


@app.command()
def uninstall() -> None:
    """Remove the Desktop's launcher entry and icon, and its AppArmor profile if you agree."""
    files = entry.Files.from_environment(os.environ)
    removed = entry.uninstall(files)
    typer.echo(f"Deleted {short_path(files.entry)}" if removed else "No launcher entry installed")
    if not apparmor.INSTALLED.exists():
        return
    typer.echo(f"Unloading and removing {apparmor.INSTALLED} takes root:")
    if _as_root(apparmor.removal_commands(), "Run them to remove it"):
        typer.echo(f"Removed {apparmor.INSTALLED}")

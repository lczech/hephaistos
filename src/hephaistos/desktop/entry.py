"""The Desktop's launcher entry and icon, so that the desktop lists it and its dock shows it.

The entry's name must match Electron's app ID (`desktopName` in `gui/package.json`), by which
GNOME tells which entry a window belongs to.
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from hephaistos import __description__
from hephaistos.daemon.unit import PATH_VARIABLES

APP_ID = "hephaistos"
ICON = Path("assets", "icon.svg")  # in the checkout
_RESERVED = re.compile(r'[\s"\'\\><~|&;$*?#()`]')  # what makes an Exec argument need quotes


def _data_home(env: Mapping[str, str]) -> Path:
    """XDG's data directory, where desktops look for entries and icons."""
    value = env.get("XDG_DATA_HOME", "")
    return Path(value) if Path(value).is_absolute() else Path.home() / ".local" / "share"


@dataclass(frozen=True)
class Files:
    """Where the entry and its icon go."""

    entry: Path
    icon: Path

    @classmethod
    def from_environment(cls, env: Mapping[str, str]) -> "Files":
        """Those of the user's desktop."""
        data = _data_home(env)
        return cls(
            data / "applications" / f"{APP_ID}.desktop",
            data / "icons" / "hicolor" / "scalable" / "apps" / f"{APP_ID}.svg",
        )


def _argument(value: str) -> str:
    """An argument of an Exec line, quoted as the Desktop Entry Specification asks."""
    if _RESERVED.search(value) is None:
        return value.replace("%", "%%")
    escaped = re.sub(r'(["`$\\])', r"\\\1", value).replace("%", "%%")
    return f'"{escaped}"'


def entry_text(executable: Path, env: Mapping[str, str]) -> str:
    """The entry that runs `executable desktop open`, with the path variables set in `env`.

    As for the Daemon's unit, so that both keep their files where this shell's hephaistos does.
    """
    variables = [f"{name}={env[name]}" for name in PATH_VARIABLES if env.get(name)]
    command = [*(["env", *variables] if variables else []), str(executable), "desktop", "open"]
    return "\n".join(
        [
            "# Written by `hephaistos desktop install`, which rewrites it; `uninstall` removes it.",
            "[Desktop Entry]",
            "Type=Application",
            "Name=hephaistos",
            f"Comment={__description__}",
            f"Exec={' '.join(_argument(word) for word in command)}",
            f"Icon={APP_ID}",
            "Terminal=false",
            "Categories=Development;",
            f"StartupWMClass={APP_ID}",
            "",
        ]
    )


def install(files: Files, text: str, icon: Path) -> bool:
    """Writes the entry and copies the icon; returns whether either changed."""
    changed = False
    for path, content in ((files.entry, text.encode()), (files.icon, icon.read_bytes())):
        if path.is_file() and path.read_bytes() == content:
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        changed = True
    return changed


def uninstall(files: Files) -> bool:
    """Removes the entry and its icon; returns whether there were any."""
    found = [path for path in (files.entry, files.icon) if path.is_file()]
    for path in found:
        path.unlink()
    return bool(found)

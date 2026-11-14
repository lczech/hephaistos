"""The Desktop's launcher entry and icon, so that the desktop lists it and its dock shows it.

The entry's name must match Electron's app ID (`desktopName` in `gui/package.json`), by which
GNOME tells which entry a window belongs to.
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from hephaistos import __description__
from hephaistos.core.utils.installation import Difference
from hephaistos.core.utils.paths import PATH_VARIABLES

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


def _string(value: str) -> str:
    """A value of type string, escaped as the specification asks.

    Desktops undo this before the quoting of an Exec line, so its backslashes are doubled.
    """
    return value.translate(
        {ord("\\"): "\\\\", ord("\n"): "\\n", ord("\t"): "\\t", ord("\r"): "\\r"}
    )


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
            f"Exec={_string(' '.join(_argument(word) for word in command))}",
            f"Icon={APP_ID}",
            "Terminal=false",
            "Categories=Development;",
            f"StartupWMClass={APP_ID}",
            "",
        ]
    )


def _command(text: str) -> str | None:
    """An entry's Exec line, without its key."""
    return next((line[5:] for line in text.splitlines() if line.startswith("Exec=")), None)


_STRING_ESCAPES = {"\\": "\\", "s": " ", "n": "\n", "t": "\t", "r": "\r"}


def _words(command: str) -> list[str]:
    r"""The arguments of an Exec line, read as desktops read it.

    An escape of a string value that is none, e.g. `\$` in an entry whose quoting backslashes
    are not doubled, stays as it is, so that its quoting still reads. Such an entry that quotes
    a backslash reads as another command: its `\\` is taken as the string escape of one
    backslash, which then quotes the next character. The two forms cannot be told apart there.
    """
    unescaped = re.sub(r"\\(.)", lambda match: _STRING_ESCAPES.get(match[1], match[0]), command)
    words: list[str] = []
    word: str | None = None
    quoted = False
    characters = iter(unescaped.replace("%%", "%"))
    for character in characters:
        if quoted and character == "\\":
            word = (word or "") + next(characters, "")
        elif character == '"':
            word, quoted = word or "", not quoted
        elif character.isspace() and not quoted:
            if word is not None:
                words.append(word)
            word = None
        else:
            word = (word or "") + character
    return words if word is None else [*words, word]


def installation_differences(files: Files, text: str) -> list[Difference]:
    """Where the installed entry runs another command than `text`, as for the Daemon.

    Its command names the hephaistos instance and the directories, so another command means another
    installation: one to replace only when asked. Commands are compared by their arguments, so
    that one written with other escapes is the same.
    """
    try:
        installed = _command(files.entry.read_text())
    except FileNotFoundError:
        return []
    wanted = _command(text)
    if installed == wanted or (installed and wanted and _words(installed) == _words(wanted)):
        return []
    return [Difference("command", installed, wanted)]


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

"""The Server's token: the secret a client sends to use this Machine's Server.

One per Machine, in its data directory, readable only by its user. Whoever can log in as that
user, e.g. over SSH, can read it (`hephaistos daemon token`); nobody else can.
"""

import contextlib
import os
import secrets
from pathlib import Path

from hephaistos.core.utils.paths import Paths, private_directory

TOKEN_BYTES = 32  # random bytes; 43 characters of URL-safe base64
MODE = 0o600


def _read(path: Path) -> str | None:
    """The token in `path`; None if there is none, or the file is empty."""
    try:
        return path.read_text().strip() or None
    except FileNotFoundError:
        return None


def _written(path: Path, value: str, *, exclusive: bool) -> None:
    """Writes `value` to a new file only the user can read; raises FileExistsError if exclusive."""
    flags = os.O_WRONLY | os.O_CREAT | (os.O_EXCL if exclusive else os.O_TRUNC)
    descriptor = os.open(path, flags, MODE)
    with os.fdopen(descriptor, "w") as file:
        file.write(value + "\n")


def renew(paths: Paths) -> str:
    """Replaces the token with a new one, which every client then needs; returns it."""
    path = paths.token
    private_directory(path.parent)
    new = path.with_name(f"{path.name}.new")
    with contextlib.suppress(FileNotFoundError):
        new.unlink()
    value = secrets.token_urlsafe(TOKEN_BYTES)
    _written(new, value, exclusive=True)
    new.replace(path)
    return value


def token(paths: Paths) -> str:
    """The token, created on first use."""
    path = paths.token
    if (found := _read(path)) is not None:
        return found
    if path.exists():  # empty: never fully written
        return renew(paths)
    private_directory(path.parent)
    value = secrets.token_urlsafe(TOKEN_BYTES)
    try:
        _written(path, value, exclusive=True)
    except FileExistsError:  # created meanwhile, e.g. by the Server
        return token(paths)
    return value


def tighten(paths: Paths) -> bool:
    """Makes the token readable only by the user again; returns whether others could read it."""
    path = paths.token
    if not path.stat().st_mode & 0o077:
        return False
    path.chmod(MODE)
    return True


def matches(given: str, expected: str) -> bool:
    """Whether a client gave the token; in the same time however much of it matches."""
    return secrets.compare_digest(given.encode(), expected.encode())


class TokenFile:
    """The token as the Server knows it, read again whenever the file changed."""

    def __init__(self, paths: Paths) -> None:
        """Reads the token from `paths`, creating it if there is none."""
        self._paths = paths
        self._seen: tuple[int, int] | None = None  # the file's inode and modification time
        self._value = ""

    def current(self) -> str:
        """The token now."""
        try:
            info = self._paths.token.stat()
        except FileNotFoundError:
            info = None
        seen = None if info is None else (info.st_ino, info.st_mtime_ns)
        if seen is None or seen != self._seen:
            self._value = token(self._paths)
            info = self._paths.token.stat()
            self._seen = (info.st_ino, info.st_mtime_ns)
        return self._value

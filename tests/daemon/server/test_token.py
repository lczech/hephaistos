import os
import stat

from hephaistos.core.utils.paths import TOKEN_NAME, Paths
from hephaistos.daemon.server import token
from hephaistos.daemon.server.token import TokenFile


def _mode(paths: Paths) -> int:
    return stat.S_IMODE(paths.token.stat().st_mode)


def test_created_once_readable_only_by_its_user(paths: Paths) -> None:
    first = token.token(paths)
    assert len(first) == 43
    assert first.replace("-", "").replace("_", "").isalnum()
    assert token.token(paths) == first
    assert _mode(paths) == 0o600
    assert not token.tighten(paths)


def test_renewed(paths: Paths) -> None:
    first = token.token(paths)
    renewed = token.renew(paths)
    assert renewed != first
    assert token.token(paths) == renewed
    assert _mode(paths) == 0o600
    assert [path.name for path in paths.data_dir.iterdir()] == [TOKEN_NAME]


def test_an_empty_file_gets_a_new_token(paths: Paths) -> None:
    paths.data_dir.mkdir(parents=True)
    paths.token.touch()
    assert len(token.token(paths)) == 43


def test_tightened(paths: Paths) -> None:
    token.token(paths)
    paths.token.chmod(0o644)
    assert token.tighten(paths)
    assert _mode(paths) == 0o600


def test_the_server_sees_a_renewed_token(paths: Paths) -> None:
    known = TokenFile(paths)
    first = known.current()
    assert first == token.token(paths)
    assert known.current() == first
    renewed = token.renew(paths)
    assert known.current() == renewed
    os.unlink(paths.token)  # noqa: PTH108 - as a user might
    assert known.current() not in {first, renewed}


def test_matches() -> None:
    assert token.matches("abc", "abc")
    assert not token.matches("abd", "abc")
    assert not token.matches("", "abc")

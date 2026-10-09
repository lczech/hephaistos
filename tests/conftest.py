from collections.abc import Iterator
from pathlib import Path

import pytest

from hephaistos.core import config
from hephaistos.core.utils.paths import Paths


@pytest.fixture(autouse=True)
def never_real_files(
    tmp_path_factory: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Even tests without `paths` keep away from the real config, data and logs."""
    monkeypatch.setenv("HEPHAISTOS_HOME", str(tmp_path_factory.mktemp("home")))
    for key in config.KEYS:
        monkeypatch.delenv(config.variable(key), raising=False)


@pytest.fixture(autouse=True)
def default_settings() -> Iterator[None]:
    """Each test starts with the default settings, whatever the one before activated."""
    config.activate(config.DEFAULTS)
    yield
    config.activate(config.DEFAULTS)


@pytest.fixture
def paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Paths:
    """Our files in a temporary HEPHAISTOS_HOME, never in the real ones."""
    monkeypatch.setenv("HEPHAISTOS_HOME", str(tmp_path / "home"))
    return Paths.from_environment()


@pytest.fixture(autouse=True)
def isolated_git(tmp_path_factory: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch) -> None:
    """git without the user's config, and with a fixed identity for commits."""
    config = tmp_path_factory.mktemp("git") / "config"
    config.touch()
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(config))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    for role in ("AUTHOR", "COMMITTER"):
        monkeypatch.setenv(f"GIT_{role}_NAME", "Test")
        monkeypatch.setenv(f"GIT_{role}_EMAIL", "test@example.com")

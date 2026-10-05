from pathlib import Path

import pytest

from hephaistos.core.paths import Paths


@pytest.fixture
def paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Paths:
    """Our files in a temporary HEPHAISTOS_HOME, never in the real ones."""
    monkeypatch.setenv("HEPHAISTOS_HOME", str(tmp_path / "home"))
    return Paths.from_environment()

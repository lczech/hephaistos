from pathlib import Path

import pytest

from hephaistos.core.db.sessions import write_session
from hephaistos.core.registry import clones, machines, repositories
from hephaistos.core.utils.paths import Paths
from support import clone, create


@pytest.fixture
def repo(paths: Paths, tmp_path: Path) -> Path:
    """A set-up Machine with Clone `repo` of Repository `proj`, cloned from `origin`."""
    machines.set_up(paths, "laptop")
    repo = clone(create(tmp_path / "origin"), tmp_path / "repo")
    candidate = clones.inspect(repo)
    with write_session(paths) as session:
        repositories.add(session, "proj")
        clones.add(session, "proj", candidate)
    return repo

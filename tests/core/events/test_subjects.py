from pathlib import Path

import pytest

from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.events import events, subjects
from hephaistos.core.registry import clones, machines, repositories
from hephaistos.core.utils.ids import new_id
from hephaistos.core.utils.paths import Paths
from support import create


@pytest.fixture
def set_up(paths: Paths) -> Paths:
    machines.set_up(paths, "laptop")
    return paths


def test_labels_by_subject_type(set_up: Paths, tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    with write_session(set_up) as session:
        repositories.add(session, "proj")
        clones.add(session, "proj", clones.inspect(repo))
        session.conn.execute(
            "INSERT INTO events VALUES (?, ?, ?, 'newer.thing', ?, 20, '{}', NULL, NULL)",
            (new_id(), session.tick(), session.machine_id, new_id()),
        )
    with write_session(set_up) as session:
        repositories.rename(session, "proj", "project")
        clones.remove(session, repo)

    with read_session(set_up) as session:
        found = events.recent(session)
        labels = subjects.labels(session, found)
    by_kind = {event.kind: labels.get(event.subject) for event in found}
    assert by_kind == {
        "machine.added": "laptop",
        "filesystem.added": "laptop-local",
        "mount.added": Path("/"),
        # The current name, also for Events from before the rename.
        "repository.added": "project",
        "repository.changed": "project",
        # Deleted records keep their labels.
        "clone.added": repo,
        "clone.deleted": repo,
        "newer.thing": None,
    }

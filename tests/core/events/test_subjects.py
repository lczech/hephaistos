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


def test_names_paths_and_repositories_by_subject_type(set_up: Paths, tmp_path: Path) -> None:
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
        clones.remove(session, clones.removable(session, repo))

    with read_session(set_up) as session:
        found = events.recent(session)
        names = subjects.names(session, found)
        paths = subjects.paths(session, found)
        repository_ids = subjects.repository_ids(session, found)
    by_kind = {event.kind: (names.get(event.subject), paths.get(event.subject)) for event in found}
    assert by_kind == {
        "machine.added": ("laptop", None),
        "filesystem.added": ("laptop-local", None),
        "mount.added": (None, Path("/")),
        # The current name, also for Events from before the rename.
        "repository.added": ("project", None),
        "repository.changed": ("project", None),
        # Deleted records keep their names and paths.
        "clone.added": (None, repo),
        "clone.deleted": (None, repo),
        "newer.thing": (None, None),
    }
    [repository] = {event.subject for event in found if event.kind == "repository.added"}
    assert {event.kind: repository_ids.get(event.subject) for event in found} == {
        "machine.added": None,
        "filesystem.added": None,
        "mount.added": None,
        "repository.added": repository,
        "repository.changed": repository,
        "clone.added": repository,
        "clone.deleted": repository,
        "newer.thing": None,
    }

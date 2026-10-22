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
        repositories.register(session, "proj")
        clones.register(session, "proj", clones.inspect(repo))
        session.conn.execute(
            "INSERT INTO events VALUES (?, ?, ?, 'newer.thing', ?, 20, '{}', NULL, NULL)",
            (new_id(), session.tick(), session.machine_id, new_id()),
        )
    with write_session(set_up) as session:
        repositories.rename(session, "proj", "project")
        clones.unregister(session, clones.find_to_unregister(session, repo))

    with read_session(set_up) as session:
        found = events.recent(session)
        names = subjects.names(session, found)
        paths = subjects.paths(session, found)
        repository_ids = subjects.repository_ids(session, found)
    by_kind = {event.kind: (names.get(event.subject), paths.get(event.subject)) for event in found}
    assert by_kind == {
        "machine.registered": ("laptop", None),
        "filesystem.registered": ("laptop-local", None),
        "mount.registered": (None, Path("/")),
        # The current name, also for Events from before the rename.
        "repository.registered": ("project", None),
        "repository.changed": ("project", None),
        # Deleted records keep their names and paths.
        "clone.registered": (None, repo),
        "clone.unregistered": (None, repo),
        "newer.thing": (None, None),
    }
    [repository] = {event.subject for event in found if event.kind == "repository.registered"}
    assert {event.kind: repository_ids.get(event.subject) for event in found} == {
        "machine.registered": None,
        "filesystem.registered": None,
        "mount.registered": None,
        "repository.registered": repository,
        "repository.changed": repository,
        "clone.registered": repository,
        "clone.unregistered": repository,
        "newer.thing": None,
    }

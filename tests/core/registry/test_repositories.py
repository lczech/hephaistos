import json

import pytest

from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.registry import machines, repositories
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths


@pytest.fixture
def set_up(paths: Paths) -> Paths:
    machines.set_up(paths, "laptop")
    return paths


def test_add_and_find(set_up: Paths) -> None:
    with write_session(set_up) as session:
        added = repositories.add(session, "proj")
    with read_session(set_up) as session:
        assert repositories.by_name(session, "proj") == added
        [summary] = repositories.summaries(session)
    assert summary.repository == added
    assert summary.clones == 0


@pytest.mark.parametrize("name", ["", " proj", "proj "])
def test_names_must_be_trimmed_and_not_empty(set_up: Paths, name: str) -> None:
    with write_session(set_up) as session, pytest.raises(HephaistosError, match="empty"):
        repositories.add(session, name)


def test_names_are_unique(set_up: Paths) -> None:
    with write_session(set_up) as session:
        repositories.add(session, "proj")
    with write_session(set_up) as session, pytest.raises(HephaistosError, match="already"):
        repositories.add(session, "proj")


def test_unknown_name(set_up: Paths) -> None:
    with read_session(set_up) as session, pytest.raises(HephaistosError, match="no Repository"):
        repositories.by_name(session, "proj")


def test_rename_records_an_event(set_up: Paths) -> None:
    with write_session(set_up) as session:
        added = repositories.add(session, "proj")
    with write_session(set_up) as session:
        repositories.rename(session, "proj", "project")
    with read_session(set_up) as session:
        assert repositories.by_name(session, "project").id == added.id
        row = session.conn.execute(
            "SELECT kind, subject, payload FROM events ORDER BY recorded_at DESC LIMIT 1"
        ).fetchone()
    assert row["kind"] == "repository.changed"
    assert row["subject"] == added.id.bytes
    assert json.loads(row["payload"]) == {"id": str(added.id), "name": "project"}

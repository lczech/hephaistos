import json
from pathlib import Path

import pytest

from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.db.tables import Table
from hephaistos.core.events.kinds import EventKind
from hephaistos.core.registry import clones, machines, records, repositories
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths
from support import clone, create


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
    assert json.loads(row["payload"]) == {"name": {"old": "proj", "new": "project"}}


def test_remove_frees_the_name(set_up: Paths) -> None:
    with write_session(set_up) as session:
        added = repositories.add(session, "proj")
    with write_session(set_up) as session:
        repositories.remove(session, "proj")
    with read_session(set_up) as session:
        assert repositories.summaries(session) == []
        row = session.conn.execute(
            "SELECT kind, subject FROM events ORDER BY recorded_at DESC LIMIT 1"
        ).fetchone()
    assert (row["kind"], row["subject"]) == ("repository.deleted", added.id.bytes)
    with write_session(set_up) as session:
        assert repositories.add(session, "proj").id != added.id


def test_remove_refuses_with_clones(set_up: Paths, tmp_path: Path) -> None:
    with write_session(set_up) as session:
        repositories.add(session, "proj")
        clones.add(session, "proj", clones.inspect(create(tmp_path / "repo")))
    with write_session(set_up) as session, pytest.raises(HephaistosError, match="still has"):
        repositories.remove(session, "proj")


def test_change_without_difference_records_nothing(set_up: Paths) -> None:
    with write_session(set_up) as session:
        added = repositories.add(session, "proj")
        before = session.conn.execute("SELECT count(*) FROM events").fetchone()[0]
        records.change(
            session, Table.REGISTRY_REPOSITORIES, EventKind.REPOSITORY_CHANGED, added, added
        )
        assert session.conn.execute("SELECT count(*) FROM events").fetchone()[0] == before


def test_summaries_count_clones_and_their_main_remotes(set_up: Paths, tmp_path: Path) -> None:
    repo = create(tmp_path / "repo", origin="git@host:me/proj.git")
    copy = clone(repo, tmp_path / "copy")  # its origin is the local path
    with write_session(set_up) as session:
        repositories.add(session, "proj")
        repositories.add(session, "empty")
        clones.add(session, "proj", clones.inspect(repo))
        clones.add(session, "proj", clones.inspect(copy))
    with read_session(set_up) as session:
        empty, proj = repositories.summaries(session)
    assert (empty.clones, empty.remotes) == (0, ())
    assert (proj.clones, proj.remotes) == (2, (str(repo), "host/me/proj"))

import dataclasses
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest

from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.db.tables import Table
from hephaistos.core.events.kinds import EventKind
from hephaistos.core.observers import clones as observer
from hephaistos.core.registry import clones, machines, records, repositories
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import new_id
from hephaistos.core.utils.paths import Paths
from support import clone, create, git


@pytest.fixture
def set_up(paths: Paths) -> Paths:
    machines.set_up(paths, "laptop")
    return paths


def test_register_and_find(set_up: Paths) -> None:
    with write_session(set_up) as session:
        added = repositories.register(session, "proj")
    with read_session(set_up) as session:
        assert repositories.by_name(session, "proj") == added
        [summary] = repositories.summaries(session)
    assert summary.repository == added
    assert summary.clones == 0


INVALID_NAMES = ["", " proj", "a/b", "~/Repos/proj", ".", "..", "My Thesis", "café", "x" * 101]


@pytest.mark.parametrize("name", INVALID_NAMES)
def test_names_have_githubs_characters(set_up: Paths, name: str) -> None:
    with (
        write_session(set_up) as session,
        pytest.raises(HephaistosError, match="not a Repository name"),
    ):
        repositories.register(session, name)


@pytest.mark.parametrize("name", INVALID_NAMES)
def test_the_schema_checks_names_too(set_up: Paths, name: str) -> None:
    with write_session(set_up) as session:
        added = repositories.register(session, "proj")
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            session.conn.execute(
                "UPDATE registry_repositories SET name = ? WHERE id = ?", (name, added.id.bytes)
            )


@pytest.mark.parametrize("name", ["a-b_c.d", ".github", "X" * 100])
def test_valid_names(set_up: Paths, name: str) -> None:
    with write_session(set_up) as session:
        assert repositories.register(session, name).name == name


@pytest.mark.parametrize(
    ("text", "name"),
    [
        ("proj", "proj"),
        ("My Thesis (draft)", "My-Thesis-draft"),
        ("café au lait", "caf-au-lait"),
        ("x" * 120, "x" * 100),
        ("Проект", None),
        ("..", None),
    ],
)
def test_derived_names(text: str, name: str | None) -> None:
    assert repositories.derived_name(text) == name


def test_names_are_unique_and_found_ignoring_case(set_up: Paths) -> None:
    with write_session(set_up) as session:
        added = repositories.register(session, "Proj")
    with write_session(set_up) as session, pytest.raises(HephaistosError, match="Proj already"):
        repositories.register(session, "proj")
    with read_session(set_up) as session:
        assert repositories.by_name(session, "PROJ") == added
    with write_session(set_up) as session, pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        records.add(
            session,
            Table.REGISTRY_REPOSITORIES,
            EventKind.REPOSITORY_REGISTERED,
            dataclasses.replace(added, id=new_id(), name="proj"),
        )


def test_rename_may_change_only_the_case(set_up: Paths) -> None:
    with write_session(set_up) as session:
        repositories.register(session, "proj")
        repositories.register(session, "other")
    with write_session(set_up) as session:
        assert repositories.rename(session, "proj", "Proj").name == "Proj"
    with write_session(set_up) as session, pytest.raises(HephaistosError, match="already"):
        repositories.rename(session, "Proj", "OTHER")
    with write_session(set_up) as session, pytest.raises(HephaistosError, match="not a Repo"):
        repositories.rename(session, "Proj", "a/b")


def test_unknown_name(set_up: Paths) -> None:
    with read_session(set_up) as session, pytest.raises(HephaistosError, match="no Repository"):
        repositories.by_name(session, "proj")


def test_rename_records_an_event(set_up: Paths) -> None:
    with write_session(set_up) as session:
        added = repositories.register(session, "proj")
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


def test_unregister_frees_the_name(set_up: Paths) -> None:
    with write_session(set_up) as session:
        added = repositories.register(session, "proj")
    with write_session(set_up) as session:
        repositories.unregister(session, "proj")
    with read_session(set_up) as session:
        assert repositories.summaries(session) == []
        row = session.conn.execute(
            "SELECT kind, subject FROM events ORDER BY recorded_at DESC LIMIT 1"
        ).fetchone()
    assert (row["kind"], row["subject"]) == ("repository.unregistered", added.id.bytes)
    with write_session(set_up) as session:
        assert repositories.register(session, "proj").id != added.id


def test_unregister_refuses_with_clones(set_up: Paths, tmp_path: Path) -> None:
    with write_session(set_up) as session:
        repositories.register(session, "proj")
        clones.register(session, "proj", clones.inspect(create(tmp_path / "repo")))
    with write_session(set_up) as session, pytest.raises(HephaistosError, match="still has"):
        repositories.unregister(session, "proj")


def test_change_without_difference_records_nothing(set_up: Paths) -> None:
    with write_session(set_up) as session:
        added = repositories.register(session, "proj")
        before = session.conn.execute("SELECT count(*) FROM events").fetchone()[0]
        records.change(
            session, Table.REGISTRY_REPOSITORIES, EventKind.REPOSITORY_CHANGED, added, added
        )
        assert session.conn.execute("SELECT count(*) FROM events").fetchone()[0] == before


def test_summaries_count_clones_and_their_main_remotes(set_up: Paths, tmp_path: Path) -> None:
    repo = create(tmp_path / "repo", origin="git@host:me/proj.git")
    copy = clone(repo, tmp_path / "copy")  # its origin is the local path
    with write_session(set_up) as session:
        repositories.register(session, "proj")
        repositories.register(session, "empty")
        clones.register(session, "proj", clones.inspect(repo))
        clones.register(session, "proj", clones.inspect(copy))
    with read_session(set_up) as session:
        empty, proj = repositories.summaries(session)
    assert (empty.clones, empty.remotes) == (0, ())
    assert (proj.clones, proj.remotes) == (2, (str(repo), "host/me/proj"))


def test_summaries_say_when_head_last_moved_in_any_checkout(
    set_up: Paths, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = create(tmp_path / "repo")
    with write_session(set_up) as session:
        repositories.register(session, "proj")
        repositories.register(session, "empty")
        clones.register(session, "proj", clones.inspect(repo))
    observer.observe(set_up)  # reading the reflogs starts at their ends
    with read_session(set_up) as session:
        [details] = clones.details(session)
    assert details.state.active_at is not None
    later = datetime(2030, 1, 2, 3, 4, 5, tzinfo=UTC)
    monkeypatch.setenv("GIT_COMMITTER_DATE", later.isoformat())  # git's time for reflog entries
    git(repo, "worktree", "add", "--quiet", str(tmp_path / "feature"))
    observer.observe(set_up)
    with read_session(set_up) as session:
        empty, proj = repositories.summaries(session)
        [details] = clones.details(session)
    assert empty.active_at is None
    assert [worktree.active_at for worktree in details.worktrees] == [later]
    assert details.state.active_at is not None
    assert details.state.active_at < later
    assert proj.active_at == later

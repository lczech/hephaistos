import sqlite3
import uuid
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.registry import machines
from hephaistos.core.state import terminals
from hephaistos.core.state.terminals import Changes, TerminalStatus
from hephaistos.core.terminals.keeper import Session
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import new_id
from hephaistos.core.utils.paths import Paths

BOOT = "boot-1"
STARTED = datetime(2026, 11, 6, 9, 0, tzinfo=UTC)


@pytest.fixture
def set_up(paths: Paths) -> Paths:
    machines.set_up(paths, "laptop")
    return paths


def session(name: str, terminal_id: uuid.UUID | None = None, **changed: object) -> Session:
    """A session as the Keeper lists it."""
    made = Session(
        key=f"${abs(hash(name)) % 1000}",
        terminal_id=terminal_id,
        id_text="" if terminal_id is None else str(terminal_id),
        name=name,
        directory=Path("/home/u/proj"),
        current_directory=Path("/home/u/proj/src"),
        program="bash",
        pid=4242,
        clients=0,
        created_at=STARTED,
        active_at=STARTED,
        panes=1,
    )
    return replace(made, **changed)


def update(paths: Paths, *found: Session, running: bool = True, boot: str = BOOT) -> Changes:
    with write_session(paths) as written:
        return terminals.update(written, found, running=running, boot_id=boot)


def stored(paths: Paths) -> dict[str, terminals.TerminalState]:
    with read_session(paths) as read:
        return {state.name: state for state in terminals.on_this_machine(read)}


def statuses(paths: Paths) -> dict[str, TerminalStatus]:
    return {name: state.status for name, state in stored(paths).items()}


def test_found_ones_are_stored(set_up: Paths) -> None:
    api = new_id()
    assert update(set_up, session("api", api)) == Changes(open=1, added=1, ended=0, lost=0)
    state = stored(set_up)["api"]
    assert (state.id, state.status, state.boot_id, state.command) == (api, "open", BOOT, None)
    assert (state.directory, state.current_directory) == (
        Path("/home/u/proj"),
        Path("/home/u/proj/src"),
    )
    assert (state.started_at, state.program, state.clients, state.panes) == (STARTED, "bash", 0, 1)
    with read_session(set_up) as read:
        assert state.observed_by == read.machine_id


def test_observing_again_changes_only_what_changed(set_up: Paths) -> None:
    api = new_id()
    update(set_up, session("api", api))
    first = stored(set_up)["api"]
    later = datetime(2026, 11, 6, 10, 0, tzinfo=UTC)
    assert update(set_up, session("api", api, program="vim", clients=1, active_at=later)) == (
        Changes(open=1, added=0, ended=0, lost=0)
    )
    second = stored(set_up)["api"]
    assert (second.program, second.clients, second.active_at) == ("vim", 1, later)
    assert second.observed_at > first.observed_at
    assert (
        replace(second, program="bash", clients=0, active_at=STARTED, observed_at=first.observed_at)
        == first
    )


def test_the_directory_stays_where_it_started(set_up: Paths) -> None:
    api = new_id()
    update(set_up, session("api", api))
    update(set_up, session("api", api, directory=Path("/elsewhere")))
    assert stored(set_up)["api"].directory == Path("/home/u/proj")


def test_sessions_without_an_id_wait(set_up: Paths) -> None:
    assert update(set_up, session("mine")) == Changes(open=0, added=0, ended=0, lost=0)
    assert stored(set_up) == {}


def test_ended_with_the_server_running(set_up: Paths) -> None:
    update(set_up, session("api", new_id()), session("web", new_id()))
    assert update(set_up, session("web", stored(set_up)["web"].id)) == Changes(1, 0, 1, 0)
    assert statuses(set_up) == {"web": "open"}


def test_lost_when_the_server_died(set_up: Paths) -> None:
    update(set_up, session("api", new_id()))
    assert update(set_up, running=False) == Changes(open=0, added=0, ended=0, lost=1)
    assert statuses(set_up) == {"api": "lost"}
    assert update(set_up, running=False) == Changes(0, 0, 0, 0)  # lost stays lost


def test_lost_after_a_reboot(set_up: Paths) -> None:
    update(set_up, session("api", new_id()))
    assert update(set_up, running=True, boot="boot-2").lost == 1  # e.g. a new server since
    assert statuses(set_up) == {"api": "lost"}


def test_lost_ones_are_open_again_once_found(set_up: Paths) -> None:
    api = new_id()
    update(set_up, session("api", api))
    update(set_up, running=False)
    assert update(set_up, session("api", api), boot="boot-2") == Changes(1, 0, 0, 0)
    state = stored(set_up)["api"]
    assert (state.status, state.boot_id) == ("open", "boot-2")


def test_a_rename_by_hand(set_up: Paths) -> None:
    api = new_id()
    update(set_up, session("api", api))
    update(set_up, session("web", api))
    assert {name: state.id for name, state in stored(set_up).items()} == {"web": api}


def test_a_rename_onto_a_lost_ones_name(set_up: Paths) -> None:
    api, web = new_id(), new_id()
    update(set_up, session("api", api), session("web", web))
    update(set_up, session("web", web), running=False)  # api lost, as if crashed alone
    with write_session(set_up) as written:
        written.conn.execute("UPDATE state_terminals SET status = 'lost' WHERE id = ?", (api,))
    update(set_up, session("api", web))
    assert {name: (state.id, state.status) for name, state in stored(set_up).items()} == {
        "api": (web, "open"),
        "api-1": (api, "lost"),
    }


def test_names_swapped_by_hand(set_up: Paths) -> None:
    api, web = new_id(), new_id()
    update(set_up, session("api", api), session("web", web))
    update(set_up, session("web", api), session("api", web))
    assert {name: state.id for name, state in stored(set_up).items()} == {"web": api, "api": web}


@pytest.mark.parametrize("name", ["x y", "ünï-😀", "-lead", "tab\tname"])
def test_names_made_by_hand_are_kept(set_up: Paths, name: str) -> None:
    update(set_up, session(name, new_id()))
    assert list(stored(set_up)) == [name]


def test_another_machines_names_are_its_own(set_up: Paths) -> None:
    update(set_up, session("api", new_id()))
    with write_session(set_up) as written:
        other = new_id()  # as Sync will bring it
        written.conn.execute(
            "INSERT INTO registry_machines (id, name, hostname, modified_at, modified_by)"
            " VALUES (?, 'gaia', 'gaia', ?, ?)",
            (other, written.tick(), other),
        )
        written.conn.execute(
            "INSERT INTO state_terminals SELECT ?, name, directory, command, status, boot_id,"
            " started_at, active_at, current_directory, program, clients, panes, observed_at, ?"
            " FROM state_terminals",
            (new_id(), other),
        )
    assert update(set_up, session("api", stored(set_up)["api"].id)).ended == 0
    with read_session(set_up) as read:
        rows = read.conn.execute("SELECT count(*) FROM state_terminals").fetchone()[0]
    assert rows == 2


def test_commands_are_kept(set_up: Paths) -> None:
    api = new_id()
    with write_session(set_up) as written:
        terminals.update(
            written,
            [session("api", api)],
            running=True,
            boot_id=BOOT,
            command={api: ("make", "test")},
        )
    update(set_up, session("api", api))
    assert stored(set_up)["api"].command == ("make", "test")


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("name", ""),
        ("status", "ended"),
        ("boot_id", ""),
        ("command", '"make"'),
        ("command", "not json"),
        ("clients", -1),
        ("panes", 0),
        ("id", b"short"),
    ],
)
def test_the_schema_refuses(set_up: Paths, column: str, value: object) -> None:
    update(set_up, session("api", new_id()))
    with pytest.raises(sqlite3.IntegrityError), write_session(set_up) as written:
        written.conn.execute(f"UPDATE state_terminals SET {column} = ?", (value,))  # noqa: S608


def test_one_name_per_machine(set_up: Paths) -> None:
    update(set_up, session("api", new_id()))
    with pytest.raises(sqlite3.IntegrityError), write_session(set_up) as written:
        written.conn.execute(
            "INSERT INTO state_terminals SELECT ?, name, directory, command, status, boot_id,"
            " started_at, active_at, current_directory, program, clients, panes, observed_at,"
            " observed_by FROM state_terminals",
            (new_id(),),
        )


def test_default_names(set_up: Paths) -> None:
    with read_session(set_up) as read:
        assert terminals.default_name(read, Path("/home/u/My Thesis")) == "My-Thesis-1"
        assert terminals.default_name(read, Path("/home/u/.config")) == "config-1"
        assert terminals.default_name(read, Path("/")) == "terminal-1"
        assert terminals.default_name(read, Path("/x/" + "a" * 80)) == "a" * 62 + "-1"
    update(set_up, session("proj-1", new_id()), session("proj-3", new_id()))
    update(set_up, running=False)  # lost ones keep their names
    with read_session(set_up) as read:
        assert terminals.default_name(read, Path("/home/u/proj")) == "proj-2"


@pytest.mark.parametrize("name", ["api", "api-2", "_x", "A_b-9", "x" * 64])
def test_valid_names(name: str) -> None:
    terminals.NAMES.check(name)


@pytest.mark.parametrize("name", ["", "-x", "a.b", "a:b", "a b", "café", "x" * 65])
def test_invalid_names(name: str) -> None:
    with pytest.raises(HephaistosError, match="is not a terminal name"):
        terminals.NAMES.check(name)


def test_many_terminals(set_up: Paths) -> None:
    found = [session(f"t{n}", new_id(), key=f"${n}") for n in range(200)]
    assert update(set_up, *found).added == 200
    assert update(set_up, *found).open == 200

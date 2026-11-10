import sqlite3
import uuid
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.registry import machines
from hephaistos.core.state import terminals
from hephaistos.core.state.terminals import Changes, TerminalStatus
from hephaistos.core.terminals.keeper import Session
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import MAX_DRIFT_MS, Timestamp, new_id, wall_ms
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


def clock(paths: Paths) -> Timestamp:
    """The clock now, as an observation reads it before asking the Keeper."""
    with read_session(paths) as read:
        return read.clock_value


def update(
    paths: Paths,
    *found: Session,
    running: bool = True,
    boot: str = BOOT,
    started: Timestamp | None = None,
) -> Changes:
    """Stores `found`, as asked when `started`; by default, just now."""
    started = clock(paths) if started is None else started
    with write_session(paths) as written:
        return terminals.update(written, found, running=running, boot_id=boot, started=started)


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


def test_ones_that_cannot_be_read_stay(set_up: Paths) -> None:
    api, web = new_id(), new_id()
    update(set_up, session("api", api), session("web", web))
    with write_session(set_up) as written:
        changes = terminals.update(
            written,
            [session("web", web)],
            running=True,
            boot_id=BOOT,
            started=clock(set_up),
            unreadable={api},
        )
    assert changes.ended == 0
    assert set(stored(set_up)) == {"api", "web"}


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


#: Names that collide when some are given and others moved to the next free number.
NAMES_TO_SHUFFLE = ["a", "a-1", "a-2", "a-1-1", "b", "b-1", "c"]


@settings(
    max_examples=60, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(data=st.data())
def test_renames_by_hand_in_one_pass(set_up: Paths, data: st.DataObject) -> None:
    """Each found one has the name of its session; the others keep their rows, lost as they were."""
    with write_session(set_up) as written:
        written.conn.execute("DELETE FROM state_terminals")
    some_names = st.lists(st.sampled_from(NAMES_TO_SHUFFLE), min_size=2, max_size=6, unique=True)
    before = {new_id(): name for name in data.draw(some_names)}
    update(set_up, *(session(name, i) for i, name in before.items()))
    lost = data.draw(st.sets(st.sampled_from(list(before)), max_size=len(before) - 1))
    with write_session(set_up) as written:
        for terminal_id in lost:
            written.conn.execute(
                "UPDATE state_terminals SET status = 'lost' WHERE id = ?", (terminal_id,)
            )
    found = data.draw(st.permutations([i for i in before if i not in lost]))
    names = st.lists(
        st.sampled_from(NAMES_TO_SHUFFLE), min_size=len(found), max_size=len(found), unique=True
    )
    after = dict(zip(found, data.draw(names), strict=True))
    update(set_up, *(session(name, i) for i, name in after.items()))
    rows = {state.id: state for state in stored(set_up).values()}
    assert rows.keys() == before.keys()
    assert {i: rows[i].name for i in after} == after
    assert {i for i, row in rows.items() if row.status is TerminalStatus.LOST} == lost


@pytest.mark.parametrize(
    ("before", "after"),
    [
        # Which Terminal, by its place in `before`, has which name, in the order tmux lists them.
        (["a-1", "b", "b-1", "a"], [(0, "a"), (1, "a-2"), (2, "a-1"), (3, "b")]),  # was a KeyError
        (["a-1", "b", "a"], [(0, "a"), (2, "a-1"), (1, "a-2")]),  # left one as `a-3`
    ],
)
def test_names_rotated_by_hand(
    set_up: Paths, before: list[str], after: list[tuple[int, str]]
) -> None:
    ids = [new_id() for _ in before]
    update(set_up, *(session(name, i) for name, i in zip(before, ids, strict=True)))
    update(set_up, *(session(name, ids[index]) for index, name in after))
    assert {state.id: name for name, state in stored(set_up).items()} == {
        ids[index]: name for index, name in after
    }


def test_names_alike_once_stored_keep_their_rows(set_up: Paths) -> None:
    # The database holds bytes that are not UTF-8 as U+FFFD, so these two names store alike.
    first, second = new_id(), new_id()
    update(set_up, session("x\udcff", first))
    update(set_up, session("x\udcff", first), session("x\udcfe", second))
    assert {state.id for state in stored(set_up).values()} == {first}


def test_a_lost_one_renamed_onto_a_taken_name(set_up: Paths) -> None:
    api, web = new_id(), new_id()
    update(set_up, session("api", api), session("web", web), running=True)
    update(set_up, session("web", web), boot="boot-2")  # api lost by a reboot
    with read_session(set_up) as read:
        lost = terminals.by_name(read, "api")
    with (
        pytest.raises(HephaistosError, match="a terminal named web exists"),
        write_session(set_up) as written,
    ):
        terminals.rename_lost(written, lost, "web")
    assert set(stored(set_up)) == {"api", "web"}


@pytest.mark.parametrize("name", ["x y", "ünï-😀", "-lead", "tab\tname"])
def test_names_made_by_hand_are_kept(set_up: Paths, name: str) -> None:
    update(set_up, session(name, new_id()))
    assert list(stored(set_up)) == [name]


def test_an_older_snapshot_leaves_newer_rows(set_up: Paths) -> None:
    api = new_id()
    started = clock(set_up)  # sessions listed: none yet
    update(set_up, session("api", api))  # created and observed meanwhile, by another process
    assert update(set_up, started=started) == Changes(open=0, added=0, ended=0, lost=0)
    assert statuses(set_up) == {"api": "open"}
    assert update(set_up, running=False, started=started).lost == 0
    assert update(set_up).ended == 1  # a snapshot taken since has it gone


def test_a_creator_tells_what_a_row_stored_first_runs(set_up: Paths) -> None:
    api = new_id()
    started = clock(set_up)  # the creator lists its new session
    update(set_up, session("api", api))  # another process stores it first, without a command
    with write_session(set_up) as written:
        terminals.update(
            written,
            [session("api", api)],
            running=True,
            boot_id=BOOT,
            started=started,
            command={api: ("make", "test")},
        )
    assert stored(set_up)["api"].command == ("make", "test")


def test_newer_readings_with_the_clock_ahead(set_up: Paths) -> None:
    """After the clock of a Peer, ahead of ours, the clock runs ahead of the wall: what counts as
    newer still follows the order of the writes."""
    with write_session(set_up) as written:
        written.clock.receive(Timestamp.of(wall_ms() + MAX_DRIFT_MS - 60_000))
    api, web = new_id(), new_id()
    update(set_up, session("api", api))
    started = clock(set_up)
    update(set_up, session("api", api), session("web", web))  # web created meanwhile
    assert update(set_up, session("api", api), started=started).ended == 0
    assert update(set_up).ended == 2


def test_an_older_snapshot_leaves_a_newer_name(set_up: Paths) -> None:
    api = new_id()
    update(set_up, session("api", api))
    started = clock(set_up)  # lists `api`
    update(set_up, session("web", api))  # renamed and observed meanwhile
    update(set_up, session("api", api), started=started)
    assert {name: state.id for name, state in stored(set_up).items()} == {"web": api}
    other = new_id()  # listed by the old snapshot, named as a newer row is
    assert update(set_up, session("web", other), started=started).added == 0
    assert {name: state.id for name, state in stored(set_up).items()} == {"web": api}


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
            started=written.clock_value,
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


def test_names_sort_numbers_as_numbers() -> None:
    names = ["proj-10", "proj-2", "proj-1", "api", "proj-100", "proj-9b"]
    assert sorted(["x²", "x1", "x٣"], key=terminals.name_order) == ["x1", "x²", "x٣"]  # by hand
    assert sorted(names, key=terminals.name_order) == [
        "api",
        "proj-1",
        "proj-2",
        "proj-9b",
        "proj-10",
        "proj-100",
    ]

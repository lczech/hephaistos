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
from hephaistos.core.terminals.keeper import Ending, Session
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import MAX_DRIFT_MS, Timestamp, new_id, wall_ms
from hephaistos.core.utils.paths import Paths

BOOT = "boot-1"
STARTED = datetime(2026, 11, 6, 9, 0, tzinfo=UTC)
#: Marks a row lost, as if its server had died, by its ID.
LOSE = (
    "UPDATE state_terminals SET status = 'lost', lost_at = 0, lost_because = 'server' WHERE id = ?"
)


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
    assert update(set_up, session("api", api)) == Changes(
        open=1, added=1, ended=0, closed=0, lost=0
    )
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
        Changes(open=1, added=0, ended=0, closed=0, lost=0)
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
    assert update(set_up, session("mine")) == Changes(open=0, added=0, ended=0, closed=0, lost=0)
    assert stored(set_up) == {}


def test_ended_with_the_server_running(set_up: Paths) -> None:
    update(set_up, session("api", new_id()), session("web", new_id()))
    assert update(set_up, session("web", stored(set_up)["web"].id)) == Changes(1, 0, 0, 1, 0)
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
    assert changes.closed == 0
    assert set(stored(set_up)) == {"api", "web"}


def test_lost_when_the_server_died(set_up: Paths) -> None:
    update(set_up, session("api", new_id()))
    assert update(set_up, running=False) == Changes(open=0, added=0, ended=0, closed=0, lost=1)
    assert statuses(set_up) == {"api": "lost"}
    assert update(set_up, running=False) == Changes(0, 0, 0, 0, 0)  # lost stays lost


def test_lost_after_a_reboot(set_up: Paths) -> None:
    update(set_up, session("api", new_id()))
    assert update(set_up, running=True, boot="boot-2").lost == 1  # e.g. a new server since
    assert statuses(set_up) == {"api": "lost"}


def test_lost_ones_are_open_again_once_found(set_up: Paths) -> None:
    api = new_id()
    update(set_up, session("api", api))
    update(set_up, running=False)
    assert update(set_up, session("api", api), boot="boot-2") == Changes(1, 0, 0, 0, 0)
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
        written.conn.execute(LOSE, (api,))
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
            written.conn.execute(LOSE, (terminal_id,))
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
    assert update(set_up, started=started) == Changes(open=0, added=0, ended=0, closed=0, lost=0)
    assert statuses(set_up) == {"api": "open"}
    assert update(set_up, running=False, started=started).lost == 0
    assert update(set_up).closed == 1  # a snapshot taken since has it gone


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
    assert update(set_up, session("api", api), started=started).closed == 0
    assert update(set_up).closed == 2


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
        copied = ", ".join("?" if c == "observed_by" else c for c in terminals.COLUMNS[1:])
        written.conn.execute(
            f"INSERT INTO state_terminals ({', '.join(terminals.COLUMNS)})"  # noqa: S608
            f" SELECT ?, {copied} FROM state_terminals",
            (new_id(), other),
        )
    assert update(set_up, session("api", stored(set_up)["api"].id)).closed == 0
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
            f"INSERT INTO state_terminals ({', '.join(terminals.COLUMNS)})"  # noqa: S608
            f" SELECT ?, {', '.join(terminals.COLUMNS[1:])} FROM state_terminals",
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


# Ended ones: their program ended, their session stays until killed; and sessions gone.

ENDED_AT = datetime(2026, 11, 6, 9, 30, tzinfo=UTC)
END = Ending(status=1, signal=None, at=ENDED_AT)


def ended(
    name: str,
    terminal_id: uuid.UUID,
    *,
    status: int | None = 1,
    signal: int | None = None,
    at: datetime | None = ENDED_AT,
) -> Session:
    """A session whose program ended: by default, exited with status 1 at ENDED_AT."""
    return session(name, terminal_id, ending=Ending(status=status, signal=signal, at=at))


def test_an_ended_one_keeps_how(set_up: Paths) -> None:
    api = new_id()
    update(set_up, session("api", api))
    assert update(set_up, ended("api", api)) == Changes(open=0, added=0, ended=1, closed=0, lost=0)
    state = stored(set_up)["api"]
    assert (state.status, state.exit_status, state.exit_signal) == ("ended", 1, None)
    assert (state.ended_at, state.lost_at, state.session_gone) == (ENDED_AT, None, False)
    assert terminals.ending_text(state) == "exited with status 1"
    assert update(set_up, ended("api", api)).ended == 0  # already


def test_one_ended_at_once_is_added_as_ended(set_up: Paths) -> None:
    changes = update(set_up, ended("build", new_id(), status=127))
    assert (changes.added, changes.ended, changes.open) == (1, 1, 0)
    assert stored(set_up)["build"].exit_status == 127


@pytest.mark.parametrize(
    ("status", "signal", "text"),
    [
        (0, None, "exited with status 0"),
        (None, 9, "ended by SIGKILL"),
        (None, 15, "ended by SIGTERM"),
        (None, 99, "ended by signal 99"),
        (None, None, "ended by a signal"),  # tmux before 3.3
    ],
)
def test_how_they_ended(set_up: Paths, status: int | None, signal: int | None, text: str) -> None:
    update(set_up, ended("api", new_id(), status=status, signal=signal))
    state = stored(set_up)["api"]
    assert (state.exit_status, state.exit_signal) == (status, signal)
    assert terminals.ending_text(state) == text


def test_when_it_ended_unless_the_keeper_says(set_up: Paths) -> None:
    """tmux before 3.3 does not say: the first observation that sees it ended stamps it."""
    api = new_id()
    update(set_up, session("api", api))
    before = datetime.now(UTC)
    update(set_up, ended("api", api, at=None))
    first = stored(set_up)["api"].ended_at
    assert first is not None
    assert before.timestamp() - 1 < first.timestamp() < datetime.now(UTC).timestamp() + 1
    update(set_up, ended("api", api, at=None))
    assert stored(set_up)["api"].ended_at == first


def test_one_that_runs_again_is_open(set_up: Paths) -> None:
    """E.g. respawned by hand: how it ended before goes."""
    api = new_id()
    update(set_up, ended("api", api))
    update(set_up, session("api", api))
    state = stored(set_up)["api"]
    assert (state.status, state.exit_status, state.ended_at) == ("open", None, None)


def test_an_ended_one_killed_by_hand_goes(set_up: Paths) -> None:
    update(set_up, ended("api", new_id()), session("web", new_id()))
    assert update(set_up, session("web", stored(set_up)["web"].id)).closed == 1
    assert statuses(set_up) == {"web": "open"}


@pytest.mark.parametrize(
    ("running", "boot", "because"), [(False, BOOT, "server"), (True, "boot-2", "reboot")]
)
def test_an_ended_one_whose_session_went_stays_ended(
    set_up: Paths,
    running: bool,  # noqa: FBT001
    boot: str,
    because: str,
) -> None:
    """With how it ended, and when and why its last screen went."""
    api = new_id()
    update(set_up, ended("api", api, status=2), session("web", new_id(), clients=1))
    before = datetime.now(UTC)
    changes = update(set_up, running=running, boot=boot)
    assert (changes.lost, changes.closed) == (2, 0)
    api_state, web_state = stored(set_up)["api"], stored(set_up)["web"]
    assert (api_state.status, api_state.exit_status, api_state.ended_at) == ("ended", 2, ENDED_AT)
    assert (web_state.status, web_state.clients) == ("lost", 0)
    for state in (api_state, web_state):
        assert state.session_gone
        assert state.lost_because == because
        assert state.lost_at is not None
        assert state.lost_at.timestamp() > before.timestamp() - 1
    assert update(set_up, running=running, boot=boot) == Changes(0, 0, 0, 0, 0)  # they stay


def test_one_whose_session_went_is_found_again(set_up: Paths) -> None:
    """E.g. adopted by a session made by hand: open, without what it was."""
    api = new_id()
    update(set_up, ended("api", api))
    update(set_up, running=False)
    update(set_up, session("api", api), boot="boot-2")
    state = stored(set_up)["api"]
    assert (state.status, state.lost_at, state.lost_because, state.exit_status) == (
        "open",
        None,
        None,
        None,
    )


def test_only_running_ones_count_as_open(set_up: Paths) -> None:
    found = [session("a", new_id()), ended("b", new_id()), ended("c", new_id(), status=0)]
    assert update(set_up, *found).open == 1


@pytest.mark.parametrize(
    "assignments",
    [
        "status = 'ended'",  # when it ended, missing
        "exit_status = 1",  # while open
        "exit_signal = 9",
        "status = 'ended', ended_at = 1, exit_status = 1, exit_signal = 9",  # both
        "status = 'ended', ended_at = 1, exit_signal = 0",
        "status = 'lost'",  # when, missing
        "lost_at = 1",  # why, missing
        "lost_because = 'server'",
        "lost_at = 1, lost_because = 'server'",  # while open
        "status = 'lost', lost_at = 1, lost_because = 'moon'",
        "status = 'gone'",
    ],
)
def test_the_schema_refuses_endings_that_cannot_be(set_up: Paths, assignments: str) -> None:
    update(set_up, session("api", new_id()))
    with pytest.raises(sqlite3.IntegrityError), write_session(set_up) as written:
        written.conn.execute(f"UPDATE state_terminals SET {assignments}")  # noqa: S608


#: How a session may end, as a Keeper says it: an exit status, or a signal, maybe which; when.
ENDINGS = st.builds(
    Ending,
    status=st.none(),
    signal=st.sampled_from([None, 9, 15]),
    at=st.sampled_from([None, ENDED_AT]),
) | st.builds(
    Ending,
    status=st.sampled_from([0, 1, 127]),
    signal=st.none(),
    at=st.sampled_from([None, ENDED_AT]),
)
#: What one observation finds of a Terminal: nothing, a session running, or one ended.
FINDINGS = st.one_of(st.just("absent"), st.just("running"), ENDINGS)
STEPS = st.lists(
    st.tuples(
        st.lists(FINDINGS, min_size=4, max_size=4),  # one each
        st.booleans(),  # whether the server runs
        st.sampled_from([BOOT, "boot-2", "boot-3"]),
    ),
    min_size=1,
    max_size=8,
)


@settings(
    max_examples=80, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(steps=STEPS)
def test_observations_follow_what_the_keeper_shows(
    set_up: Paths, steps: list[tuple[list[object], bool, str]]
) -> None:
    """Over any series of observations, each Terminal is as its session shows, or as it was when
    its session went: closed with the server running in the same boot, else gone, its row kept."""
    with write_session(set_up) as written:
        written.conn.execute("DELETE FROM state_terminals")
    ids = [new_id() for _ in range(4)]
    names = {terminal_id: f"t{n}" for n, terminal_id in enumerate(ids)}
    update(set_up, *(session(names[i], i, key=f"${n}") for n, i in enumerate(ids)))
    for findings, server, boot in steps:
        before = {state.id: state for state in stored(set_up).values()}
        found = {
            i: session(names[i], i, key=f"${n}", ending=None if f == "running" else f)
            for n, (i, f) in enumerate(zip(ids, findings, strict=True))
            if f != "absent"
        }
        running = server or bool(found)  # a server that lists sessions runs
        update(set_up, *found.values(), running=running, boot=boot)
        after = {state.id: state for state in stored(set_up).values()}
        for terminal_id in ids:
            old, new = before.get(terminal_id), after.get(terminal_id)
            if (item := found.get(terminal_id)) is not None:
                assert new is not None
                ending = item.ending
                assert new.status == ("open" if ending is None else "ended")
                assert (new.lost_at, new.lost_because, new.boot_id) == (None, None, boot)
                if ending is None:
                    assert (new.exit_status, new.exit_signal, new.ended_at) == (None, None, None)
                    continue
                assert (new.exit_status, new.exit_signal) == (ending.status, ending.signal)
                if ending.at is not None:
                    assert new.ended_at == ending.at
                elif old is not None and old.status is TerminalStatus.ENDED:
                    assert new.ended_at == old.ended_at
                else:
                    assert new.ended_at is not None
            elif old is None:
                assert new is None
            elif old.session_gone:
                assert new == old
            elif running and old.boot_id == boot:
                assert new is None  # closed
            else:
                assert new is not None
                expected = "lost" if old.status is TerminalStatus.OPEN else "ended"
                because = "server" if old.boot_id == boot else "reboot"
                assert (new.status, new.lost_because, new.clients) == (expected, because, 0)
                assert (new.exit_status, new.exit_signal, new.ended_at) == (
                    old.exit_status,
                    old.exit_signal,
                    old.ended_at,
                )
                assert new.lost_at is not None


def test_an_ended_one_keeps_the_program_it_last_ran(set_up: Paths) -> None:
    """The Keeper gives no program for a dead pane."""
    api = new_id()
    update(set_up, session("api", api, program="make", current_directory=Path("/home/u/proj/b")))
    update(set_up, session("api", api, program="", ending=END))
    state = stored(set_up)["api"]
    assert (state.program, state.current_directory) == ("make", Path("/home/u/proj/b"))


def first_seen(paths: Paths, item: Session, command: tuple[str, ...] | None) -> None:
    """Stores what an observation finds right after `item` was created, running `command`."""
    assert item.terminal_id is not None
    with write_session(paths) as written:
        terminals.update(
            written,
            [item],
            running=True,
            boot_id=BOOT,
            started=written.clock_value,
            command=None if command is None else {item.terminal_id: command},
        )


def test_one_ended_at_once_has_the_program_of_its_command(set_up: Paths) -> None:
    build = new_id()
    first_seen(set_up, session("build", build, program="", ending=END), ("/usr/bin/mkae", "test"))
    assert stored(set_up)["build"].program == "mkae"


def test_one_seen_starting_has_the_program_of_its_command_once_ended(set_up: Paths) -> None:
    """Seen first while a wrapper starts it, the Keeper giving no program, then ended."""
    build = new_id()
    first_seen(set_up, session("build", build, program=""), ("/usr/bin/make", "test"))
    assert stored(set_up)["build"].program == ""
    update(set_up, session("build", build, program="", ending=END))
    assert stored(set_up)["build"].program == "make"


def test_a_shell_seen_only_starting_has_no_program_once_ended(set_up: Paths) -> None:
    """E.g. killed by a signal at once: nothing says which shell it was."""
    shell = new_id()
    first_seen(set_up, session("sh", shell, program=""), None)
    update(set_up, session("sh", shell, program="", ending=Ending(None, 9, ENDED_AT)))
    assert stored(set_up)["sh"].program == ""

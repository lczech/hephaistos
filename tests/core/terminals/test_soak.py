import json
import random
import subprocess
import sys
import threading
import uuid
from pathlib import Path

import pytest

from hephaistos.core.db.sessions import read_session
from hephaistos.core.observers import terminals as observer
from hephaistos.core.registry import machines
from hephaistos.core.state import terminals
from hephaistos.core.state.terminals import TerminalStatus
from hephaistos.core.terminals.keeper import Session
from hephaistos.core.terminals.tmux import TmuxKeeper
from hephaistos.core.utils.paths import Paths
from support import eventually

pytestmark = [pytest.mark.tmux, pytest.mark.stress]

WORKER = Path(__file__).with_name("soak_worker.py")
PROCESSES = 4
OPERATIONS = 15  # each


def settled(paths: Paths, keeper: TmuxKeeper) -> dict[uuid.UUID | None, Session] | None:
    """The sessions, once one observation passed while none of them ended, nor closed: some
    commands end soon after they start."""

    def ends() -> dict[uuid.UUID | None, bool]:
        return {session.terminal_id: session.ending is None for session in keeper.sessions()}

    before = ends()
    observer.observe(paths, keeper)
    if ends() != before:
        return None
    return {session.terminal_id: session for session in keeper.sessions()}


def test_racing_processes_leave_state_as_tmux_has_it(
    paths: Paths, keeper: TmuxKeeper, tmp_path: Path
) -> None:
    """Processes create, rename and kill Terminals at random while another observes in a loop;
    one observation afterwards stores exactly what tmux holds, with the commands created, open
    or ended as their programs are."""
    machines.set_up(paths, "laptop")
    seeds = [random.randrange(1 << 30) for _ in range(PROCESSES)]  # noqa: S311 - not secret
    workers = [
        subprocess.Popen(
            [sys.executable, str(WORKER), str(seed), str(OPERATIONS), str(tmp_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        for seed in seeds
    ]
    done = threading.Event()
    failures: list[BaseException] = []

    def observing() -> None:
        try:
            while not done.is_set():
                observer.observe(paths, keeper)
        except BaseException as error:  # noqa: BLE001 - reported by the test
            failures.append(error)

    looping = threading.Thread(target=observing)
    looping.start()
    try:
        outputs = [worker.communicate(timeout=100) for worker in workers]
    finally:
        done.set()
        looping.join()
    for worker, (_, errors) in zip(workers, outputs, strict=True):
        assert worker.returncode == 0, f"seeds {seeds}:\n{errors}"
    assert failures == [], f"seeds {seeds}"

    sessions = eventually(lambda: settled(paths, keeper))
    assert sessions is not None
    with read_session(paths) as session:
        rows = {state.id: state for state in terminals.on_this_machine(session)}
    assert set(rows) == set(sessions), f"seeds {seeds}"
    for terminal_id, row in rows.items():
        found = sessions[terminal_id]
        status = TerminalStatus.OPEN if found.ending is None else TerminalStatus.ENDED
        assert (row.name, row.status) == (found.name, status), f"seeds {seeds}"
        if found.ending is not None:
            assert row.exit_status == found.ending.status, f"seeds {seeds}"
    created = [json.loads(line) for output, _ in outputs for line in output.splitlines()]
    for made in created:
        row = rows.get(uuid.UUID(made["id"]))
        if row is not None:  # not killed since
            expected = None if made["command"] is None else tuple(made["command"])
            assert row.command == expected, f"seeds {seeds}: {row.name}"

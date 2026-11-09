"""Properties over generated input (Hypothesis): names, escaping, and what tmux hands back."""

import os
import subprocess
import unicodedata
import uuid
from pathlib import Path

import pytest
from hypothesis import HealthCheck, example, given, settings
from hypothesis import strategies as st

from hephaistos.core.db.sessions import read_session
from hephaistos.core.registry import machines
from hephaistos.core.state import terminals
from hephaistos.core.terminals import actions
from hephaistos.core.terminals.tmux import TmuxKeeper
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths
from hephaistos.core.utils.text import escaped, utf8
from support import eventually

#: What a file name may hold: any bytes but `/` and NUL, also bytes that are not UTF-8.
FILE_NAMES = (
    st.one_of(
        st.text(st.characters(exclude_categories=("Cs",), exclude_characters="/\x00"), min_size=1),
        st.binary(min_size=1).map(lambda raw: raw.replace(b"/", b"_").replace(b"\x00", b"_")),
    )
    .map(lambda name: name if isinstance(name, str) else os.fsdecode(name))
    .filter(lambda name: name not in (".", "..") and len(os.fsencode(name)) <= 255)
)
#: What an argument of a program or an environment variable may hold: anything but NUL.
VALUES = st.text(st.characters(exclude_categories=("Cs",), exclude_characters="\x00"))
ARGUMENTS = st.lists(VALUES, max_size=5)
#: With real tmux, each example takes a moment, and the fixtures are those of the test, shared.
WITH_TMUX = settings(
    max_examples=40, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture]
)


@given(st.text())
def test_derived_names_are_names(text: str) -> None:
    name = terminals.NAMES.derived(text)
    if name is not None:
        terminals.NAMES.check(name)
        assert terminals.NAMES.derived(name) == name


@given(st.text(st.characters()))
def test_escaped_text_is_one_printable_line(text: str) -> None:
    shown = escaped(text)
    assert all(unicodedata.category(c) not in ("Cc", "Cs", "Zl", "Zp") for c in shown)
    if text.isprintable():
        assert shown == text


@pytest.fixture
def set_up(paths: Paths, keeper: TmuxKeeper) -> Paths:
    del keeper  # its server ended afterwards
    machines.set_up(paths, "laptop")
    return paths


@pytest.fixture(params=["C.UTF-8", "C"])
def locale(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> str:
    """With a UTF-8 locale, and without one, as a Daemon may run."""
    for name in ("LC_ALL", "LC_CTYPE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("LANG", request.param)
    return request.param


@pytest.mark.tmux
@pytest.mark.usefixtures("locale")
@WITH_TMUX
@given(name=FILE_NAMES, arguments=ARGUMENTS, value=VALUES)
# What tmux reads specially: formats, the end of a command, escapes it prints, a variable.
@example(name="#S", arguments=["#{pid}", ";", "x;", "\\;"], value="#{pid};")
@example(name="$HOME", arguments=["$HOME"], value="$HOME")
@example(name="a\\037b", arguments=[], value="\\")
@example(name="\x1f\b\x7f", arguments=["\x1b[31m"], value="\n")
def test_any_directory_and_command_come_back(  # noqa: PLR0913 - fixtures, then the examples
    set_up: Paths,
    keeper: TmuxKeeper,
    tmp_path: Path,
    *,
    name: str,
    arguments: list[str],
    value: str,
) -> None:
    """A Terminal in a directory of any name, running any arguments, with any value passed on:
    its program gets them as they were, tmux and State give them back so, and its default name
    is a valid one. A path that is not UTF-8 is refused."""
    directory = tmp_path / uuid.uuid4().hex / name
    directory.mkdir(parents=True)
    got = directory.parent / "got"
    script = f'printf "%s\\0" "$SSH_AUTH_SOCK" "$@" > "{got}"; exec sleep 600'
    command = ["sh", "-c", script, "sh", *arguments]
    environment = {"SSH_AUTH_SOCK": value, "PATH": os.environ["PATH"]}
    if utf8(name) != name:
        with pytest.raises(HephaistosError, match="is not UTF-8"):
            actions.create(set_up, directory, command=command, environment=environment)
        return
    created = actions.create(set_up, directory, command=command, environment=environment)
    try:
        assert eventually(lambda: got.exists() and got.read_bytes().endswith(b"\0"))
        received = [os.fsdecode(item) for item in got.read_bytes().split(b"\0")[:-1]]
        assert received == [value, *arguments]
        assert (created.directory, created.command) == (directory, tuple(command))
        terminals.NAMES.check(created.name)
        [session] = [found for found in keeper.sessions() if found.terminal_id == created.id]
        assert (session.directory, session.current_directory) == (directory, directory)
        with read_session(set_up) as read:
            assert terminals.by_id(read, created.id) == created
    finally:
        actions.kill(set_up, created.name)


#: Names tmux takes by hand: printable, without its separators `.` and `:`.
BY_HAND = st.text(
    st.characters(exclude_categories=("Cc", "Cs", "Zl", "Zp"), exclude_characters=".:"),
    min_size=1,
    max_size=30,
)


@pytest.mark.tmux
@pytest.mark.usefixtures("locale")
@WITH_TMUX
@given(name=BY_HAND)
@example(name="a$b")
@example(name="a#b")
@example(name="a\\b")
@example(name="x;")
@example(name="x²")
@example(name="#")
@example(name='"')
def test_a_session_named_by_hand_is_adopted_by_its_name(
    set_up: Paths, keeper: TmuxKeeper, tmp_path: Path, name: str
) -> None:
    """tmux escapes a name as it makes the session, e.g. a backslash doubled, and refuses some;
    whatever name it gives is that of the Terminal."""
    command = [keeper.binary, "-L", keeper.socket, "new-session", "-d", "-s", name, "-c"]
    made = subprocess.run([*command, str(tmp_path), "sleep 600"], capture_output=True, check=False)
    if made.returncode != 0:  # a name tmux refuses
        return
    listed = keeper.sessions()
    if not listed:  # tmux made it without a name, e.g. 3.8 of `#`: left alone
        subprocess.run([keeper.binary, "-L", keeper.socket, "kill-server"], check=True)
        return
    [given] = [session.name for session in listed]
    try:
        actions.observer.observe(set_up, keeper)
        with read_session(set_up) as read:
            assert [state.name for state in terminals.on_this_machine(read)] == [given]
    finally:
        actions.kill(set_up, given)

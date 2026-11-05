import pytest

from hephaistos.core.registry.repositories import NAMES
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.names import Names

#: Rules without `.` and without reserved names, as tmux's session names need.
_NO_DOTS = Names(kind="test", characters="A-Za-z0-9_-", described="letters", max_length=10)


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
def test_derived_repository_names(text: str, name: str | None) -> None:
    assert NAMES.derived(text) == name


@pytest.mark.parametrize(
    ("text", "name"),
    [("v1.2", "v1-2"), (".github", "github"), ("..", None), ("x" * 12, "x" * 10)],
)
def test_derived_names_follow_their_rules(text: str, name: str | None) -> None:
    assert _NO_DOTS.derived(text) == name


@pytest.mark.parametrize("name", ["", "a.b", "x" * 11])
def test_names_outside_their_rules_are_refused(name: str) -> None:
    with pytest.raises(
        HephaistosError, match=r"is not a test name: those have only letters, at most 10$"
    ):
        _NO_DOTS.check(name)


@pytest.mark.parametrize("name", [".", "..", "a/b", "x" * 101])
def test_repository_names_outside_the_rules_are_refused(name: str) -> None:
    with pytest.raises(
        HephaistosError,
        match=r"those have only ASCII letters, digits, '\.', '-' and '_', at most 100,"
        r" and aren't '\.' or '\.\.'$",
    ):
        NAMES.check(name)

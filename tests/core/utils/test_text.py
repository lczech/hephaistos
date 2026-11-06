import os
from pathlib import Path

import pytest

from hephaistos.core.utils.paths import short_path
from hephaistos.core.utils.text import escaped, number_text, size_text


def test_counts_with_their_nouns() -> None:
    assert (number_text(1, "Clone"), number_text(2, "Clone")) == ("1 Clone", "2 Clones")
    assert number_text(2, "entry", "entries") == "2 entries"


def test_gives_sizes_as_the_gui_does() -> None:
    sizes = [512, 3400, 12_345, 1_200_000, 5e9]
    assert [size_text(int(size)) for size in sizes] == [
        "512 B",
        "3.4 kB",
        "12 kB",
        "1.2 MB",
        "5.0 GB",
    ]


def test_gives_sizes_in_the_unit_they_round_to() -> None:
    sizes = [999, 9_960, 999_499, 999_600, 9_960_000]
    assert [size_text(size) for size in sizes] == ["999 B", "10 kB", "999 kB", "1.0 MB", "10 MB"]


@pytest.mark.parametrize(
    ("text", "shown"),
    [
        ("plain", "plain"),
        ("ünï 😀 x", "ünï 😀 x"),
        ("a\tb\nc\rd", "a\\tb\\nc\\rd"),
        ("x\x01y\x7f", "x\\x01y\\x7f"),
        (f"a{chr(0x2028)}b", "a\\u2028b"),
        (os.fsdecode(b"bad\xff"), "bad\\xff"),
        ("back\\slash", "back\\slash"),
    ],
)
def test_escaped(text: str, shown: str) -> None:
    assert escaped(text) == shown


def test_short_paths_are_escaped(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    assert short_path(tmp_path / "new\nline") == "~/new\\nline"
    assert short_path(Path("/tab\there")) == "/tab\\there"

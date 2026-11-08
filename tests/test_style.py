"""The rules of docs/style.md that a program can check: no contractions, in any tracked file."""

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).parents[1]
NOT_OURS = {"LICENSE", "uv.lock", "gui/package-lock.json"}  # text that we do not write
APOSTROPHE = "['\u2019]"  # typed, or typographic
CONTRACTION = re.compile(
    rf"\b(?:[a-z]+n{APOSTROPHE}t"  # "is not" shortened, and the like
    rf"|(?:it|that|there|what|here|who|let){APOSTROPHE}s"
    rf"|(?:i|you|we|they){APOSTROPHE}(?:m|re|ve|ll|d)"
    rf"|(?:it|that){APOSTROPHE}(?:ll|d))\b",
    re.IGNORECASE,
)


def _tracked_texts() -> list[tuple[str, str]]:
    """Each tracked file that is text, by name, with its text."""
    listed = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout
    texts: list[tuple[str, str]] = []
    for name in filter(None, listed.split("\0")):
        if name in NOT_OURS or not (ROOT / name).is_file():  # deleted, not yet staged
            continue
        try:
            texts.append((name, (ROOT / name).read_text(encoding="utf-8")))
        except UnicodeDecodeError:  # an image
            continue
    return texts


def test_no_contractions() -> None:
    found = [
        f"{name}:{number}: {match.group(0)}"
        for name, text in _tracked_texts()
        for number, line in enumerate(text.splitlines(), start=1)
        for match in CONTRACTION.finditer(line)
    ]
    assert not found, "write these out, as docs/style.md asks:\n" + "\n".join(found)


def test_contractions_are_found() -> None:
    # Written with ^ and ~ for the two apostrophes, as this file has no contractions itself.
    def text(words: str) -> str:
        return words.replace("^", "'").replace("~", "\u2019")

    contractions = text("isn~t Can^t it^s They^re we^d").split()
    others = text("the Machine^s name, o^clock, many a^s")
    found = CONTRACTION.findall(" ".join([*contractions, others]))
    assert found == contractions

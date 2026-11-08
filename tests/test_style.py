"""The rules of docs/style.md that a program can check: no contractions, in any tracked file."""

import re

from support import tracked_texts

APOSTROPHE = "['\u2019]"  # typed, or typographic
CONTRACTION = re.compile(
    rf"\b(?:[a-z]+n{APOSTROPHE}t"  # "is not" shortened, and the like
    rf"|(?:it|that|there|what|here|who|let){APOSTROPHE}s"
    rf"|(?:i|you|we|they){APOSTROPHE}(?:m|re|ve|ll|d)"
    rf"|(?:it|that){APOSTROPHE}(?:ll|d))\b",
    re.IGNORECASE,
)


def test_no_contractions() -> None:
    found = [
        f"{name}:{number}: {match.group(0)}"
        for name, text in tracked_texts()
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

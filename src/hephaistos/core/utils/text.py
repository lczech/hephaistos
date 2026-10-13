"""Text for people."""


def number_text(count: int, noun: str, plural: str | None = None) -> str:
    """`1 Clone`, `2 Clones`; `plural` for nouns not ending in `s` there."""
    return f"{count} {noun if count == 1 else plural or noun + 's'}"

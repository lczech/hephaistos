"""Text for people."""


def number_text(count: int, noun: str, plural: str | None = None) -> str:
    """`1 Clone`, `2 Clones`; `plural` for nouns not ending in `s` there."""
    return f"{count} {noun if count == 1 else plural or noun + 's'}"


_THOUSAND = 1000


def size_text(size: int) -> str:
    """A size in bytes, as `512 B`, `3.4 kB`, `12 kB`, `1.2 MB`, as the GUI shows it.

    In the unit its rounded amount stays below 1000 in: 999,600 bytes are `1.0 MB`, not `1000 kB`.
    """
    if size < _THOUSAND:
        return f"{size} B"
    for factor, unit in ((1e3, "kB"), (1e6, "MB")):
        if round(size / factor) < _THOUSAND:
            return _amount(size / factor, unit)
    return _amount(size / 1e9, "GB")


def _amount(value: float, unit: str) -> str:
    """One decimal below 10 (as rounded: 9.96 is `10`), else whole: `3.4 kB`, `12 kB`."""
    tenth = f"{value:.1f}"
    return f"{tenth} {unit}" if float(tenth) < 10 else f"{round(value)} {unit}"  # noqa: PLR2004

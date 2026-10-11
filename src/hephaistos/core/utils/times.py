"""Points in time as people give them: `2h` ago, or a date."""

import re
from datetime import datetime, timedelta

_UNIT_SECONDS = {"s": 1, "m": 60, "h": 60 * 60, "d": 24 * 60 * 60}
_DURATION = re.compile(r"(\d+)([smhd])")


def parse_time(value: str, now: datetime) -> datetime:
    """A duration before `now` (`2h`), or a date or time in ISO form, local unless it says.

    Raises ValueError, saying what it takes.
    """
    if match := _DURATION.fullmatch(value):
        return now - timedelta(seconds=int(match[1]) * _UNIT_SECONDS[match[2]])
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise ValueError(
            f"{value!r} is neither a duration like 2h nor a date like 2026-10-05"
        ) from None
    return parsed if parsed.tzinfo else parsed.astimezone()

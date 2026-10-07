"""Decoders from stored values to Python values, declared per column by the module owning a table.

Each passes NULL through as None, and falls back to `fallback` for a value that doesn't fit, so
an unexpected value is shown raw instead of failing.
"""

import json
import uuid
from collections.abc import Callable
from datetime import UTC, datetime

from hephaistos.core.utils.ids import Timestamp

type Decoder = Callable[[object], object]


def fallback(value: object) -> object:
    """Any value, as stored: bytes as hex."""
    return value.hex() if isinstance(value, bytes) else value


def plain(value: object) -> object:
    """Text and numbers, as stored."""
    return fallback(value)


def uuid_bytes(value: object) -> object:
    """An ID: 16 bytes, as a UUID."""
    if isinstance(value, bytes) and len(value) == len(uuid.UUID(int=0).bytes):
        return uuid.UUID(bytes=value)
    return fallback(value)


def hex_bytes(value: object) -> object:
    """Bytes other than IDs (e.g. a digest), as hex."""
    return fallback(value)


def _datetime(ms: int) -> datetime | None:
    """Unix milliseconds as a datetime in UTC; None out of range."""
    try:
        return datetime.fromtimestamp(ms / 1000, tz=UTC)
    except (OverflowError, OSError, ValueError):
        return None


def clock(value: object) -> object:
    """A hybrid-clock value, as a Timestamp."""
    if isinstance(value, int) and value >= 0 and _datetime(Timestamp(value).ms) is not None:
        return Timestamp(value)
    return fallback(value)


def milliseconds(value: object) -> object:
    """Unix milliseconds, as a datetime in UTC."""
    found = _datetime(value) if isinstance(value, int) else None
    return fallback(value) if found is None else found


def json_text(value: object) -> object:
    """JSON, parsed."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            pass
    return fallback(value)

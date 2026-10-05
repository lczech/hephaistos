"""IDs (UUIDv7) and time (hybrid logical clock).

A Timestamp is one integer: wall-clock milliseconds shifted left by COUNTER_BITS, plus a counter.
Timestamps sort like (milliseconds, counter), never go backwards on a Machine, and any Timestamp
issued after receiving another one is larger than it.
"""

import os
import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Self, override

COUNTER_BITS = 16
_COUNTER_MASK = (1 << COUNTER_BITS) - 1

#: Received Timestamps further ahead of our wall clock than this are rejected.
MAX_DRIFT_MS = 10 * 60 * 1000


def wall_ms() -> int:
    """The wall clock, in Unix milliseconds."""
    return time.time_ns() // 1_000_000


def new_id(ms: int | None = None) -> uuid.UUID:
    """A UUIDv7 (RFC 9562): 48 bits of Unix milliseconds, then random bits."""
    if ms is None:
        ms = wall_ms()
    rand = int.from_bytes(os.urandom(10))
    value = (ms & ((1 << 48) - 1)) << 80
    value |= 0x7 << 76  # version
    value |= ((rand >> 62) & 0xFFF) << 64
    value |= 0b10 << 62  # variant
    value |= rand & ((1 << 62) - 1)
    return uuid.UUID(int=value)


SHORT_ID_LENGTH = 8


def short_id(value: uuid.UUID) -> str:
    """The end of the UUID, which is random in a UUIDv7: enough to tell IDs apart in a list."""
    return value.hex[-SHORT_ID_LENGTH:]


def id_datetime(value: uuid.UUID) -> datetime:
    """When a UUIDv7 was created, in UTC."""
    return datetime.fromtimestamp((value.int >> 80) / 1000, tz=UTC)


class Timestamp(int):
    """A hybrid-clock value. Stored as a plain integer."""

    __slots__ = ()

    @classmethod
    def of(cls, ms: int, counter: int = 0) -> Self:
        """A Timestamp from wall-clock milliseconds and a counter."""
        if not 0 <= counter <= _COUNTER_MASK:
            raise ValueError(f"counter out of range: {counter}")
        return cls((ms << COUNTER_BITS) | counter)

    @property
    def ms(self) -> int:
        """The wall-clock part, in Unix milliseconds."""
        return self >> COUNTER_BITS

    @property
    def counter(self) -> int:
        """The counter that orders Timestamps within the same millisecond."""
        return self & _COUNTER_MASK

    @property
    def datetime(self) -> datetime:
        """The wall-clock part, in UTC."""
        return datetime.fromtimestamp(self.ms / 1000, tz=UTC)

    @override
    def __str__(self) -> str:
        """Readable form for logs and debugging, e.g. `2025-10-05 08:00:00.123 UTC #7`."""
        return f"{self.datetime:%Y-%m-%d %H:%M:%S}.{self.ms % 1000:03d} UTC #{self.counter}"

    @override
    def __repr__(self) -> str:
        """Unambiguous form, e.g. `Timestamp.of(1759651200123, 7)`."""
        return f"Timestamp.of({self.ms}, {self.counter})"


ZERO = Timestamp(0)


class ClockDriftError(Exception):
    """A received Timestamp is too far ahead of our wall clock."""


class Clock:
    """A hybrid logical clock, starting from the last Timestamp issued or received.

    The caller persists `last` (in the database, inside the same write transaction).
    """

    def __init__(self, last: Timestamp = ZERO, wall: Callable[[], int] = wall_ms) -> None:
        """Starts from `last` (persisted by the caller), reading time from `wall`."""
        self.last = last
        self._wall = wall

    def tick(self) -> Timestamp:
        """A new Timestamp, larger than every one issued or received so far."""
        now = self._wall()
        last = self.last
        if now > last.ms:
            self.last = Timestamp.of(now)
        elif last.counter < _COUNTER_MASK:
            self.last = Timestamp.of(last.ms, last.counter + 1)
        else:
            self.last = Timestamp.of(last.ms + 1)
        return self.last

    def receive(self, value: Timestamp) -> None:
        """Advance past a Timestamp received from a Peer, so later ticks sort after it."""
        ahead = value.ms - self._wall()
        if ahead > MAX_DRIFT_MS:
            raise ClockDriftError(f"received Timestamp is {ahead / 1000:.0f} s ahead")
        self.last = max(self.last, value)

import sqlite3
import uuid
from dataclasses import dataclass
from typing import Self

from hephaistos.core.registry.records import Record


@dataclass(frozen=True, kw_only=True)
class Filesystem(Record):
    """A set of paths that resolve to the same files on every Machine that mounts it."""

    name: str

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> Self:
        """Builds a Filesystem from a database row with its columns."""
        return cls(id=uuid.UUID(bytes=row["id"]), name=row["name"])

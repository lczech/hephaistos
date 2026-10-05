"""Opening the database: read sessions (read-only) and write sessions (one transaction each).

Only write sessions advance the clock; it is stored in `meta` within the same transaction, so
Timestamps from this Machine increase in commit order across all processes.
"""

import hashlib
import sqlite3
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from importlib.resources import files
from pathlib import Path, PosixPath

from hephaistos.core.utils.errors import (
    AlreadySetUpError,
    HephaistosError,
    NotSetUpError,
    SchemaOutdatedError,
)
from hephaistos.core.utils.ids import Clock, Timestamp
from hephaistos.core.utils.paths import Paths, mount_of

MIN_SQLITE = (3, 37, 0)  # STRICT tables
SCHEMA_VERSION = 1
SCHEMA = files("hephaistos.core.db").joinpath("schema.sql").read_text()
# Until migrations exist, any change to the schema makes existing databases outdated.
SCHEMA_HASH = hashlib.sha256(SCHEMA.encode()).hexdigest()[:16]
BUSY_TIMEOUT_MS = 5000

sqlite3.register_adapter(uuid.UUID, lambda value: value.bytes)
sqlite3.register_adapter(PosixPath, str)


class ReadSession:
    """Read-only access to the database; any write fails."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        """Wraps an open connection and reads this Machine's ID from it."""
        self.conn = conn
        machine_id = self.meta("machine_id")
        if not isinstance(machine_id, bytes):
            raise HephaistosError("the database has no Machine ID")
        self.machine_id = uuid.UUID(bytes=machine_id)

    def meta(self, key: str) -> object:
        """A value from the local `meta` table, or None if the key is missing."""
        row = self.conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return None if row is None else row[0]

    @property
    def clock_value(self) -> Timestamp:
        """The latest Timestamp any write session on this database has given."""
        last = self.meta("clock")
        return Timestamp(last if isinstance(last, int) else 0)

    @property
    def journal_mode(self) -> str:
        """SQLite's journal mode: `wal`, or `delete` on network filesystems."""
        return str(self.conn.execute("PRAGMA journal_mode").fetchone()[0])


class WriteSession(ReadSession):
    """One write transaction, with the clock loaded from `meta`."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        """Wraps a connection inside an open transaction and loads the clock."""
        super().__init__(conn)
        self.clock = Clock(self.clock_value)

    def tick(self) -> Timestamp:
        """A new Timestamp; saved with the transaction's commit."""
        return self.clock.tick()


def _connect(database: Path, *, read_only: bool) -> sqlite3.Connection:
    """Opens a connection with our settings; transactions are managed explicitly."""
    if sqlite3.sqlite_version_info < MIN_SQLITE:
        raise HephaistosError(f"SQLite {sqlite3.sqlite_version} is too old; need 3.37 or later")
    mode = "ro" if read_only else "rwc"
    conn = sqlite3.connect(f"{database.as_uri()}?mode={mode}", uri=True, autocommit=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
    return conn


def _open(paths: Paths, *, read_only: bool, check_schema: bool = True) -> sqlite3.Connection:
    """Opens this Machine's database, after checking it exists and has our schema."""
    if not paths.database.exists():
        raise NotSetUpError
    conn = _connect(paths.database, read_only=read_only)
    if not check_schema:
        return conn
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    row = conn.execute("SELECT value FROM meta WHERE key = 'schema_hash'").fetchone()
    if version != SCHEMA_VERSION or row is None or row[0] != SCHEMA_HASH:
        conn.close()
        raise SchemaOutdatedError
    return conn


@contextmanager
def read_session(paths: Paths, *, check_schema: bool = True) -> Generator[ReadSession]:
    """A read-only session on this Machine's database; on an outdated one only if unchecked."""
    conn = _open(paths, read_only=True, check_schema=check_schema)
    try:
        yield ReadSession(conn)
    finally:
        conn.close()


@contextmanager
def _transaction(conn: sqlite3.Connection) -> Generator[WriteSession]:
    """Runs a write session as one transaction, saving the clock on commit."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        session = WriteSession(conn)
        yield session
        conn.execute("UPDATE meta SET value = ? WHERE key = 'clock'", (session.clock.last,))
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise


@contextmanager
def write_session(paths: Paths) -> Generator[WriteSession]:
    """A write session on this Machine's database: committed on success, else rolled back."""
    conn = _open(paths, read_only=False)
    try:
        with _transaction(conn) as session:
            yield session
    finally:
        conn.close()


def data_dir_is_network(paths: Paths) -> bool:
    """Whether our data directory lies on a network filesystem."""
    return mount_of(paths.data_dir).is_network


def _sidecars(database: Path) -> tuple[Path, Path]:
    """SQLite's WAL and shared-memory files, which it finds next to the database by name."""
    return Path(f"{database}-wal"), Path(f"{database}-shm")


def _keep_backup(paths: Paths) -> None:
    """Moves the database to its backup, replacing an earlier one."""
    backup = paths.database_backup
    for path in (backup, *_sidecars(backup)):
        path.unlink(missing_ok=True)
    wal, shm = _sidecars(paths.database)
    if wal.exists():
        wal.rename(_sidecars(backup)[0])
    shm.unlink(missing_ok=True)
    paths.database.rename(backup)


@contextmanager
def create_database(
    paths: Paths, machine_id: uuid.UUID, *, replace: bool = False
) -> Generator[WriteSession]:
    """Creates the database and yields its first write session.

    The database is built under a temporary name and only moved into place once that session
    has committed, so a failed setup leaves nothing that counts as set up, and with `replace`
    the existing database untouched. Once replaced, it is kept as a backup.
    """
    if paths.database.exists() and not replace:
        raise AlreadySetUpError(paths.database)
    paths.data_dir.mkdir(parents=True, exist_ok=True)
    paths.state_dir.mkdir(parents=True, exist_ok=True)
    building = paths.database.with_name(paths.database.name + ".new")
    for leftover in (building, *_sidecars(building)):
        leftover.unlink(missing_ok=True)

    # SQLite's WAL mode needs shared memory, which network filesystems don't provide.
    journal_mode = "DELETE" if data_dir_is_network(paths) else "WAL"
    conn = _connect(building, read_only=False)
    try:
        conn.execute(f"PRAGMA journal_mode = {journal_mode}")
        conn.execute("BEGIN IMMEDIATE")
        conn.executescript(SCHEMA)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        conn.executemany(
            "INSERT INTO meta (key, value) VALUES (?, ?)",
            [("machine_id", machine_id), ("clock", 0), ("schema_hash", SCHEMA_HASH)],
        )
        conn.execute("COMMIT")
        with _transaction(conn) as session:
            yield session
    except BaseException:
        conn.close()
        building.unlink(missing_ok=True)
        raise
    conn.close()
    if paths.database.exists():
        _keep_backup(paths)
    building.rename(paths.database)

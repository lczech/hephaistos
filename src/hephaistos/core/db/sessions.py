"""Opening the database: read sessions (read-only) and write sessions (one transaction each).

Only write sessions advance the clock; it is stored in `meta` within the same transaction, so
Timestamps from this Machine increase in commit order across all processes.
"""

import hashlib
import logging
import sqlite3
import time
import uuid
from collections.abc import Collection, Generator, Iterator
from contextlib import contextmanager
from importlib.resources import files
from pathlib import Path, PosixPath

from hephaistos.core.db import values
from hephaistos.core.db.values import Decoder
from hephaistos.core.utils.errors import (
    AlreadySetUpError,
    DatabaseBusyError,
    HephaistosError,
    NotSetUpError,
    SchemaMismatchError,
)
from hephaistos.core.utils.ids import Clock, Timestamp
from hephaistos.core.utils.paths import Paths, mount_of, private_directory

MIN_SQLITE = (3, 37, 0)  # STRICT tables
SCHEMA_VERSION = 3  # one more with each change to the schema
SCHEMA = files("hephaistos.core.db").joinpath("schema.sql").read_text()
# Until migrations exist, any change to the schema makes existing databases outdated; the hash
# also catches a change that forgot to count up the version.
SCHEMA_HASH = hashlib.sha256(SCHEMA.encode()).hexdigest()[:16]
BUSY_TIMEOUT_MS = 5000

log = logging.getLogger(__name__)

sqlite3.register_adapter(uuid.UUID, lambda value: value.bytes)
sqlite3.register_adapter(PosixPath, str)

#: The columns of `meta`, decoded for raw listings; its values by `META_VALUES`.
DECODERS: dict[str, Decoder] = {"key": values.plain, "value": values.plain}
#: The values in `meta`, by key.
META_VALUES: dict[str, Decoder] = {
    "machine_id": values.uuid_bytes,
    "clock": values.clock,
    "schema_hash": values.plain,
}


class ReadSession:
    """Read-only access to the database; any write fails."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        """Wraps an open connection and reads this Machine's ID from it."""
        self.conn = conn
        machine_id = self.meta("machine_id")
        if not isinstance(machine_id, bytes):
            raise HephaistosError("the database has no machine ID")
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
    def schema_mismatch(self) -> SchemaMismatchError | None:
        """How the database's schema differs from this version's; only in unchecked sessions."""
        return _schema_mismatch(self.conn)

    @property
    def data_version(self) -> int:
        """A number that changes whenever another connection commits; kept sessions compare it."""
        return int(self.conn.execute("PRAGMA data_version").fetchone()[0])

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
        self.recorded: list[tuple[str, uuid.UUID, uuid.UUID]] = []  # kind, ID, subject ID

    def tick(self) -> Timestamp:
        """A new Timestamp; saved with the transaction's commit."""
        return self.clock.tick()


_CHUNK = 1000  # well below SQLite's limit on variables per statement


def chunks(ids: Collection[uuid.UUID]) -> Iterator[list[uuid.UUID]]:
    """The IDs in lists small enough for one `IN (…)` statement each."""
    listed = list(ids)
    for start in range(0, len(listed), _CHUNK):
        yield listed[start : start + _CHUNK]


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


def _schema_mismatch(conn: sqlite3.Connection) -> SchemaMismatchError | None:
    """How the database's schema differs from this version's; None if it doesn't."""
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    row = conn.execute("SELECT value FROM meta WHERE key = 'schema_hash'").fetchone()
    if version == SCHEMA_VERSION and row is not None and row[0] == SCHEMA_HASH:
        return None
    return SchemaMismatchError(version, SCHEMA_VERSION)


def _open(paths: Paths, *, read_only: bool, check_schema: bool = True) -> sqlite3.Connection:
    """Opens this Machine's database, after checking it exists and has our schema."""
    if not paths.database.exists():
        raise NotSetUpError
    conn = _connect(paths.database, read_only=read_only)
    if check_schema and (mismatch := _schema_mismatch(conn)) is not None:
        conn.close()
        raise mismatch
    return conn


@contextmanager
def _reporting_busy() -> Generator[None]:
    """Reports a database that stayed locked longer than the busy timeout as ours to show."""
    try:
        yield
    except sqlite3.OperationalError as error:
        if error.sqlite_errorcode & 0xFF == sqlite3.SQLITE_BUSY:  # also its extended codes
            raise DatabaseBusyError(BUSY_TIMEOUT_MS / 1000) from error
        raise


@contextmanager
def read_session(paths: Paths, *, check_schema: bool = True) -> Generator[ReadSession]:
    """A read-only session on this Machine's database; on an outdated one only if unchecked."""
    with _reporting_busy():
        conn = _open(paths, read_only=True, check_schema=check_schema)
        try:
            yield ReadSession(conn)
        finally:
            conn.close()


@contextmanager
def _transaction(conn: sqlite3.Connection) -> Generator[WriteSession]:
    """Runs a write session as one transaction, saving the clock on commit; logs how it ended."""
    started = time.monotonic()
    conn.execute("BEGIN IMMEDIATE")
    session: WriteSession | None = None
    try:
        session = WriteSession(conn)
        yield session
        conn.execute("UPDATE meta SET value = ? WHERE key = 'clock'", (session.clock.last,))
        conn.execute("COMMIT")
    except BaseException as error:
        conn.execute("ROLLBACK")
        cause = f"{type(error).__name__}: {error}" if str(error) else type(error).__name__
        events = len(session.recorded) if session else 0
        duration = round(time.monotonic() - started, 3)
        log.warning("rolled back: %s", cause, extra={"events": events, "duration": duration})
        raise
    duration = round(time.monotonic() - started, 3)
    log.debug("committed", extra={"events": len(session.recorded), "duration": duration})
    for kind, event, subject in session.recorded:
        log.info("recorded %s", kind, extra={"event": event, "subject": subject})


@contextmanager
def write_session(paths: Paths) -> Generator[WriteSession]:
    """A write session on this Machine's database: committed on success, else rolled back."""
    with _reporting_busy():
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
    private_directory(paths.data_dir)
    private_directory(paths.state_dir)
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

-- The whole schema. IDs are UUIDv7 as 16 bytes; times are hybrid-clock Timestamps.
-- Registry tables end with: modified_at, modified_by, deleted.

CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value ANY
) STRICT;

-- Registry

CREATE TABLE registry_machines (
    id            BLOB PRIMARY KEY CHECK (length(id) = 16),
    name          TEXT NOT NULL,
    hostname      TEXT NOT NULL,
    chassis       TEXT,  -- as systemd names it: laptop, server, vm, …; NULL if unknown
    os_machine_id TEXT,
    modified_at   INTEGER NOT NULL,
    modified_by   BLOB NOT NULL REFERENCES registry_machines (id),
    deleted       INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
) STRICT;
CREATE UNIQUE INDEX registry_machines_name ON registry_machines (name) WHERE deleted = 0;

CREATE TABLE registry_filesystems (
    id          BLOB PRIMARY KEY CHECK (length(id) = 16),
    name        TEXT NOT NULL,
    modified_at INTEGER NOT NULL,
    modified_by BLOB NOT NULL REFERENCES registry_machines (id),
    deleted     INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
) STRICT;
CREATE UNIQUE INDEX registry_filesystems_name ON registry_filesystems (name) WHERE deleted = 0;

CREATE TABLE registry_mounts (
    id            BLOB PRIMARY KEY CHECK (length(id) = 16),
    machine_id    BLOB NOT NULL REFERENCES registry_machines (id),
    filesystem_id BLOB NOT NULL REFERENCES registry_filesystems (id),
    path          TEXT NOT NULL,
    modified_at   INTEGER NOT NULL,
    modified_by   BLOB NOT NULL REFERENCES registry_machines (id),
    deleted       INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
) STRICT;
CREATE UNIQUE INDEX registry_mounts_path ON registry_mounts (machine_id, path) WHERE deleted = 0;

CREATE TABLE registry_repositories (
    id          BLOB PRIMARY KEY CHECK (length(id) = 16),
    -- As GitHub's: ASCII letters, digits, `.`, `-` and `_`; compared ignoring case.
    name        TEXT NOT NULL COLLATE NOCASE CHECK (
        length(name) BETWEEN 1 AND 100
        AND name NOT GLOB '*[^A-Za-z0-9._-]*'
        AND name NOT IN ('.', '..')
    ),
    modified_at INTEGER NOT NULL,
    modified_by BLOB NOT NULL REFERENCES registry_machines (id),
    deleted     INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
) STRICT;
CREATE UNIQUE INDEX registry_repositories_name ON registry_repositories (name) WHERE deleted = 0;

CREATE TABLE registry_clones (
    id            BLOB PRIMARY KEY CHECK (length(id) = 16),
    repository_id BLOB NOT NULL REFERENCES registry_repositories (id),
    filesystem_id BLOB NOT NULL REFERENCES registry_filesystems (id),
    resolved_path TEXT NOT NULL,
    display_path  TEXT NOT NULL,
    modified_at   INTEGER NOT NULL,
    modified_by   BLOB NOT NULL REFERENCES registry_machines (id),
    deleted       INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1))
) STRICT;
CREATE UNIQUE INDEX registry_clones_path
    ON registry_clones (filesystem_id, resolved_path) WHERE deleted = 0;
CREATE INDEX registry_clones_repository ON registry_clones (repository_id);

-- State

CREATE TABLE state_clones (
    clone_id     BLOB PRIMARY KEY REFERENCES registry_clones (id),
    observed_at  INTEGER NOT NULL,
    observed_by  BLOB NOT NULL REFERENCES registry_machines (id),
    present      INTEGER NOT NULL CHECK (present IN (0, 1)),
    bare         INTEGER NOT NULL CHECK (bare IN (0, 1)),
    head         TEXT,
    branch       TEXT,  -- NULL when HEAD is detached
    upstream     TEXT,
    ahead        INTEGER,  -- NULL without upstream; status columns are NULL when bare
    behind       INTEGER,
    staged       INTEGER,
    changed      INTEGER,
    untracked    INTEGER,
    conflicted   INTEGER,
    root_commits TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(root_commits)),
    remotes      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(remotes)),
    branches     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(branches)),
    error        TEXT,
    -- Where reading the reflogs stopped; NULL until the first read, which starts at the end.
    head_log     TEXT,  -- HEAD's: seconds and digest of the last entry read
    push_log     TEXT CHECK (json_valid(push_log))  -- by remote-tracking ref
) STRICT;

CREATE TABLE state_worktrees (
    id          BLOB PRIMARY KEY CHECK (length(id) = 16),
    clone_id    BLOB NOT NULL REFERENCES registry_clones (id),
    name        TEXT NOT NULL,  -- git's admin directory: <common dir>/worktrees/<name>
    path        TEXT NOT NULL,  -- as git reports it
    lock_reason TEXT,           -- NULL unless locked; may be away temporarily if locked
    observed_at INTEGER NOT NULL,
    observed_by BLOB NOT NULL REFERENCES registry_machines (id),
    present     INTEGER NOT NULL CHECK (present IN (0, 1)),
    head        TEXT,
    branch      TEXT,
    upstream    TEXT,
    ahead       INTEGER,
    behind      INTEGER,
    staged      INTEGER,
    changed     INTEGER,
    untracked   INTEGER,
    conflicted  INTEGER,
    error       TEXT,
    head_log    TEXT,
    removed     INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0, 1))  -- kept for its Events
) STRICT;
CREATE UNIQUE INDEX state_worktrees_name ON state_worktrees (clone_id, name) WHERE removed = 0;

CREATE TABLE state_terminals (
    id                BLOB PRIMARY KEY CHECK (length(id) = 16),
    name              TEXT NOT NULL CHECK (name <> ''),  -- the Keeper's; adopted ones may be any
    directory         TEXT NOT NULL,  -- where it started
    command           TEXT CHECK (  -- its arguments as a JSON list; NULL for a shell
        command IS NULL OR CASE WHEN json_valid(command) THEN json_type(command) = 'array' ELSE 0 END
    ),
    status            TEXT NOT NULL CHECK (status IN ('open', 'ended', 'lost')),
    boot_id           TEXT NOT NULL CHECK (boot_id <> ''),  -- of the boot it last ran in
    started_at        INTEGER NOT NULL,  -- milliseconds since 1970 by the Machine's clock
    active_at         INTEGER NOT NULL,  -- likewise: its last input or output
    current_directory TEXT,  -- of its foreground process; NULL if unknown
    program           TEXT NOT NULL,  -- in its foreground, e.g. bash; last known while lost
    clients           INTEGER NOT NULL CHECK (clients >= 0),  -- attached, e.g. Terminal emulators
    panes             INTEGER NOT NULL CHECK (panes >= 1),  -- more if split outside hephaistos
    exit_status       INTEGER,  -- of an ended one that exited; NULL if a signal ended it
    exit_signal       INTEGER CHECK (exit_signal > 0),  -- that ended it, if the Keeper says which
    ended_at          INTEGER,  -- milliseconds since 1970: when it ended, or was first seen so
    lost_at           INTEGER,  -- likewise: when its session was found gone; NULL while it has one
    lost_because      TEXT CHECK (lost_because IN ('reboot', 'server')),  -- or the Keeper's ended
    observed_at       INTEGER NOT NULL,
    observed_by       BLOB NOT NULL REFERENCES registry_machines (id),
    CHECK ((status = 'ended') = (ended_at IS NOT NULL)),
    CHECK (status = 'ended' OR (exit_status IS NULL AND exit_signal IS NULL)),
    CHECK (exit_status IS NULL OR exit_signal IS NULL),
    CHECK ((lost_at IS NULL) = (lost_because IS NULL)),
    CHECK (status <> 'lost' OR lost_at IS NOT NULL),
    CHECK (status <> 'open' OR lost_at IS NULL)
) STRICT;
CREATE UNIQUE INDEX state_terminals_name ON state_terminals (observed_by, name);

-- Events

CREATE TABLE events (
    id          BLOB PRIMARY KEY CHECK (length(id) = 16),
    recorded_at INTEGER NOT NULL,
    recorded_by BLOB NOT NULL REFERENCES registry_machines (id),
    kind        TEXT NOT NULL,
    subject     BLOB NOT NULL CHECK (length(subject) = 16),
    priority    INTEGER NOT NULL,
    payload     TEXT NOT NULL CHECK (json_valid(payload)),
    occurred_at INTEGER,  -- milliseconds since 1970 by the source's clock; NULL if unknown
    key         BLOB CHECK (length(key) = 16)  -- the same fact seen by several Machines
) STRICT;
CREATE INDEX events_recorded_by ON events (recorded_by, recorded_at);
CREATE INDEX events_recorded_at ON events (recorded_at);
CREATE INDEX events_subject ON events (subject, recorded_at);
CREATE INDEX events_kind ON events (kind, recorded_at);
CREATE INDEX events_key ON events (key) WHERE key IS NOT NULL;

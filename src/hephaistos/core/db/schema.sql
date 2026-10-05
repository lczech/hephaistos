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
    name        TEXT NOT NULL,
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
    head         TEXT,
    branch       TEXT,  -- NULL when HEAD is detached
    root_commits TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(root_commits)),
    remotes      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(remotes)),
    error        TEXT
) STRICT;

CREATE TABLE state_worktrees (
    id            BLOB PRIMARY KEY CHECK (length(id) = 16),
    clone_id      BLOB NOT NULL REFERENCES registry_clones (id),
    resolved_path TEXT NOT NULL,
    observed_at   INTEGER NOT NULL,
    observed_by   BLOB NOT NULL REFERENCES registry_machines (id),
    present       INTEGER NOT NULL CHECK (present IN (0, 1)),
    head          TEXT,
    branch        TEXT,
    error         TEXT,
    UNIQUE (clone_id, resolved_path)
) STRICT;

-- Events

CREATE TABLE events (
    id          BLOB PRIMARY KEY CHECK (length(id) = 16),
    recorded_at INTEGER NOT NULL,
    recorded_by BLOB NOT NULL REFERENCES registry_machines (id),
    kind        TEXT NOT NULL,
    subject     BLOB NOT NULL CHECK (length(subject) = 16),
    priority    INTEGER NOT NULL,
    payload     TEXT NOT NULL CHECK (json_valid(payload))
) STRICT;
CREATE INDEX events_recorded ON events (recorded_by, recorded_at);
CREATE INDEX events_subject ON events (subject, recorded_at);
CREATE INDEX events_kind ON events (kind, recorded_at);

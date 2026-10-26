# Data

The database's tables, and how the Core reads and writes them ([ADR 003](../decisions/003-core.md)).
`hephaistos db` shows them as stored ([commands](../cli/commands.md#db)).

## Tables

| Table | Columns |
|---|---|
| `meta` | `key`, `value`: this Machine's ID, the clock |
| `registry_machines` | `id`, `name`, `hostname`, `chassis`, `os_machine_id` |
| `registry_filesystems` | `id`, `name` |
| `registry_mounts` | `id`, `machine_id`, `filesystem_id`, `path` |
| `registry_repositories` | `id`, `name` |
| `registry_clones` | `id`, `repository_id`, `filesystem_id`, `resolved_path`, `display_path` |
| `state_clones` | `clone_id`, `observed_at`, `observed_by`, `present`, `bare`, `head`, `branch` (NULL when detached), status (`upstream`, `ahead`, `behind`, `staged`, `changed`, `untracked`, `conflicted`; NULL when bare), `root_commits` (JSON), `remotes` (JSON), `branches` (JSON), `error`, `head_log` and `push_log` (reflog cursors) |
| `state_worktrees` | `id`, `clone_id`, `name` (git's), `path` (as git reports it), `lock_reason`, `observed_at`, `observed_by`, `present`, `head`, `branch`, status (as for Clones), `error`, `head_log`, `removed` |
| `events` | `id`, `recorded_at`, `recorded_by`, `kind`, `subject`, `priority`, `payload` (JSON), `occurred_at`, `key` |

Table names start with their category (`registry_`, `state_`); `events` and `meta` stand alone.
Entity names are plural.
A relationship with a natural noun takes that noun, e.g. `registry_mounts`.
The code keeps a list of tables with their category, used by Sync and raw listings.
The module that owns a table declares how to decode each column (`DECODERS`: IDs, clock values, JSON); a test holds these to the schema.

## Columns

IDs are UUIDv7, stored as 16 bytes.
Times are hybrid logical clock values, stored as one INTEGER: milliseconds << 16 | counter.
The clock lives in the database and advances inside each write transaction.
So values from one Machine increase in commit order, across CLI and Daemon.
Data received from Peers advances the clock past the largest value seen.
Columns are named `<verb>_at` for times and `<verb>_by` for the Machine that did it.
JSON output uses the same names; text output drops the suffix, e.g. `recorded`.

## Registry tables

Registry tables carry `modified_at`, `modified_by` and `deleted`.
A deletion is an edit, its time being `modified_at`.
Last write wins, for edits and deletions alike.
Uniqueness applies only to rows not deleted.
Every change records an Event:
- `<entity>.registered` or `.unregistered`, with the record's values;
- `<entity>.changed`, with the changed fields' old and new values.

A kind may say more in that shape, e.g. `clone.moved`.
The user registers and unregisters what the Registry declares; what git does is added and removed, e.g. `worktree.added` and `.removed`.

## Names

Names are unique per entity type: Machines, Filesystems and Repositories.
A Repository's name is as GitHub's: ASCII letters, digits, `.`, `-` and `_`, at most 100 characters, not `.` or `..`.
Repository names are compared and looked up ignoring case (`COLLATE NOCASE`); the schema checks both rules.
So a name is never a path: `repo register` given a directory's path says so, and prints the `clone register` command for it.
A display title, if wanted, would be a field of its own.
For a Clone that matches no Repository, `clone register` suggests a name from the origin remote (`…/hephaistos.git` → `hephaistos`), else from the directory.
Each run of other characters becomes a `-`, as on GitHub (`My Thesis` → `My-Thesis`).

## Paths

`resolved_path` has all symlinks resolved; it is used for identity and comparison.
`display_path` is the absolute path as typed, with symlinks kept.
Display shortens the home directory to `~`.
Worktrees under their Clone show relative to it.
A path's Filesystem is found through its mount, in `/proc/self/mountinfo`.

## Remotes and root commits

Remotes are stored without credentials.
They are matched in normalised form: `git@host:a/b.git` and `https://host/a/b` are the same.
Root commits are those of all local and remote-tracking branches.
Worktrees share their Clone's root commits and remotes.

## Bare repositories

A bare repository is a Clone whose path is its git directory.
It has Worktrees, but no files to open.

## Worktrees

A Worktree is identified by its Clone and git's admin name (`<git common dir>/worktrees/<name>`).
The admin name survives `git worktree move` (`worktree.moved`).
A new Worktree gets a UUIDv7.
One whose directory is gone was removed (`worktree.removed`); its row stays, marked `removed`, for its Events.
If it is locked with `git worktree lock`, it is missing instead.
If a Worktree of that name comes back with its reflog continuing where reading stopped, it is the same one again (`worktree.restored`).
That happens when it is back from an unmounted filesystem, or was moved by hand and repaired.
Worktrees sync as part of their Clone's snapshot; the newest wins.
Observing keeps the locally known ID for a name, so Machines converge after one sync.

## Sessions

The Core opens the database either read-only (SQLite `mode=ro`) or as one write transaction.
A write session advances the clock and records Events.
Viewing gets only read sessions, so an accidental write fails: the CLI's `list` and `show`, and the Server's read endpoints.
Asking the user happens between a read and a write session, so no write transaction waits for input.

## Schema version

The schema's version is `PRAGMA user_version`, one more with each change, plus a hash of the schema in `meta`.
Until releases, a schema change edits the schema itself; the code has no migrations.
A one-off script carries over data worth keeping, rebuilding changed tables in place.
Otherwise `setup --reset` replaces the database, keeping a backup.
A database with another schema is reported by how it differs:
- older: `setup --reset`;
- newer: restart the Daemon, or update;
- changed at the same version.

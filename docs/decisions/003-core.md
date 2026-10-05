# 003: Core foundations

Status: accepted (2026-10-05)

## Context

The first slice needs the Core's foundations: storing Registry, State and Events, setting up a Machine, and observing Checkouts. Terminals, Launchers, plugins, Sync and the GUI come later; nothing here may block them.

## Package layout

One Python package (Python ≥ 3.12), `pyproject.toml` at the repository root, src layout. uv manages the environment; `uv.lock` is committed. During development, `uv tool install --editable .` puts `hephaistos` on the path, following the current code. The parts from [002](002-technology-stack.md) are subpackages; `gui/` stays outside. A test checks that `core` imports none of the other parts.

```
src/hephaistos/
  core/
    config.py     TOML
    db/           connection, read and write sessions, schema
    registry/     machines.py, filesystems.py, mounts.py, repositories.py, clones.py
    state/        clones.py, worktrees.py
    events/       storage and reading, kinds.py
    observers/    clones.py
    utils/
      errors.py   errors with messages for the user
      ids.py      UUIDv7, hybrid logical clock
      paths.py    XDG directories, per-Machine subdirectory, filesystem type detection
      git.py      reads facts by running git's commands for scripts; knows nothing about our records
  cli/            one module per subcommand, named like it (clone.py for `hephaistos clone`)
  daemon/{watcher,sync,server}/
  plugins/
```

Core modules about a kind of thing are plural (`clones.py`, `ids.py`), which keeps them apart from variables (`clone`, `id`); modules about one thing are singular (`git.py`). Each entity's dataclass lives next to its SQL. Operations spanning several modules (e.g. adding a Clone: git facts, Repository, Clone, Events) live with the entity they mainly concern; no separate operations layer.

Tools: Typer for the CLI (with shell completion; heavy imports only inside commands, to keep startup fast), ruff, a type checker, pytest. The Core keeps dependencies minimal.

## Setup and files

- `hephaistos setup` is required once per Machine. Every other command fails until then (except `--help` and `--version`); `setup` fails on a Machine that is already set up.
- Setup's core part is one transaction: directories, database, Machine record (named after the hostname), and its default Filesystem mounted at `/`. Later setup steps (hooks, autostart, remote setup) also exist as their own commands.
- Files follow XDG, always in a per-Machine subdirectory keyed by `/etc/machine-id` (hostname as fallback), so shared home directories need no configuration:
  - config: `~/.config/hephaistos/config.toml`, optional; built-in defaults apply.
  - data: `~/.local/share/hephaistos/<machine>/`
  - logs: `~/.local/state/hephaistos/<machine>/`, rotating files.
- `HEPHAISTOS_HOME`, if set, puts config, data and logs into that one directory instead. Tests always use it, and so can experiments.
- SQLite runs in WAL mode, or with a rollback journal if the data directory is on a network filesystem (detected via `statfs`).
- A Machine set up twice (e.g. after deleting its data) gets a new ID; the same `os_machine_id` suggests merging them.

## Conventions

- **IDs:** UUIDv7, stored as 16 bytes.
- **Time:** a hybrid logical clock, stored as one INTEGER (milliseconds << 16 | counter). The clock lives in the database and advances inside each write transaction, so values from one Machine increase in commit order, across CLI and Daemon. Data received from Peers advances it past the largest value seen.
- **Column names:** `<verb>_at` for times, `<verb>_by` for the Machine that did it.
- **Registry tables** carry `modified_at`, `modified_by` and `deleted`. A deletion is an edit (its time is `modified_at`), and last write wins for edits and deletions alike. Uniqueness applies only to rows not deleted. Every change records an Event `<entity>.added`, `.changed` or `.deleted` with the new values.
- **Table names:** prefixed with their category (`registry_`, `state_`), plus `events` and `meta`; plural entity names; a relationship with a natural noun takes that noun (`registry_mounts`). The code keeps a list of tables with their category, used by Sync and raw views.
- **Read and write sessions:** the Core opens the database either read-only (SQLite `mode=ro`) or as one write transaction, which advances the clock and records Events. Viewing (CLI `list` and `show`, the Server's read endpoints) only gets read sessions, so an accidental write fails.
- **Schema version:** `PRAGMA user_version`. Until the data is relied on, schema changes edit the initial schema, and an outdated database is reported with a clear message (delete it and run `setup` again; one-off scripts where data is worth keeping). Migrations start from a declared schema 1.

## Tables

| Table | Columns |
|---|---|
| `meta` | `key`, `value`: this Machine's ID, the clock |
| `registry_machines` | `id`, `name`, `hostname`, `os_machine_id` |
| `registry_filesystems` | `id`, `name` |
| `registry_mounts` | `id`, `machine_id`, `filesystem_id`, `path` |
| `registry_repositories` | `id`, `name` |
| `registry_clones` | `id`, `repository_id`, `filesystem_id`, `resolved_path`, `display_path` |
| `state_clones` | `clone_id`, `observed_at`, `observed_by`, `present`, `bare`, `head`, `branch` (NULL when detached), `root_commits` (JSON), `remotes` (JSON), `error` |
| `state_worktrees` | `id`, `clone_id`, `resolved_path`, `observed_at`, `observed_by`, `present`, `head`, `branch`, `error` |
| `events` | `id`, `recorded_at`, `recorded_by`, `kind`, `subject`, `priority`, `payload` (JSON) |

- Names are unique per entity type (Machines, Filesystems, Repositories).
- A Repository is added by name. For a Clone that matches none, `clone add` suggests a name from the origin remote (`…/hephaistos.git` → `hephaistos`), else the directory.
- Paths: `resolved_path` has all symlinks resolved and is used for identity and comparison; `display_path` is the absolute path as typed, symlinks kept. Display shortens the home directory to `~`; Worktrees under their Clone show relative to it. A path's Filesystem is found through its mount (`/proc/self/mountinfo`); recognising shared Filesystems across Machines comes later.
- Remotes are stored without credentials and matched in normalised form (`git@host:a/b.git` and `https://host/a/b` are the same). Root commits are those of all local and remote-tracking branches. Worktrees share their Clone's root commits and remotes.
- A bare repository is a Clone whose path is its git directory; it has Worktrees but no files to open.
- Worktrees are identified by Clone and path while they exist: a new one gets a UUIDv7, a vanished one is removed with a `worktree.removed` Event, and one recreated at the same path is new. They sync as part of their Clone's snapshot, newest wins; observing keeps the locally known ID for a path, so Machines converge after one sync.

## Events

- Kinds are a `StrEnum` in `events/kinds.py`, stored as dotted text (`clone.branch_switched`); the prefix gives the subject's type. Kinds unknown to this version (from newer Peers) are kept and shown raw.
- One payload dataclass per kind; other related IDs go into the payload.
- Priority: low 10, normal 20, high 30, urgent 40. The origin sets it from a default per kind; high and above will be pushed right away.
- Later, with Agents: how an Event was captured, and whether it is reported or inferred.

## Observation

- An observer observes one kind of thing: it takes a snapshot, compares it with the stored State, and writes the changes and their Events through shared code. Observers know nothing about timing; the Watcher schedules them, with intervals per observer in its config.
- Each observation updates `observed_at`; rows and Events change only when something changed.
- First observer: `clones` (git), which also finds their Worktrees.
- Views show stored State with its age; they never observe. `--refresh` observes first, in a separate write session.

## CLI for the first slice

One subcommand per entity, with the verbs `list`, `show`, `add`, `remove`, `rename`; a few top-level verbs act across entities. Entities are addressed by name, Checkouts by path (`.` by default), and entities without a name by a short ID (the end of the UUID).

```
hephaistos setup
hephaistos machine show
hephaistos repo list | show <name> | add <name> | rename <name> <new name>
hephaistos clone add [path] [--repo <name>]
hephaistos clone list [--repo <name>] | show | remove
hephaistos worktree list [--repo <name>] | show
hephaistos event list
hephaistos observe [clones [--clone <path>]]
hephaistos db tables | db dump <table>
```

- `clone add` attaches to an existing Repository only. If the Clone matches Repositories (root commits, remotes), it asks in a terminal; without one, it requires `--repo`. Without a match, it fails and shows the commands to add the Repository first. It refuses a Clone that shares no root commit with the Repository's other Clones (such Repositories don't count as matches either), and a path inside a Worktree (the message names its Clone).
- Asking happens between a read and a write session, so no write transaction waits for input.
- Output: plain aligned text; `--json` on `list` and `show`. Times are relative in lists (`3m`, `2h`, `5d`), full in `show` (`2026-10-05 14:03:21`), ISO 8601 in JSON; `--time relative|short|full` and `time_format` in the config override this.

Next: the Server and GUI pages showing these tables, plus a Repository overview.

## Rejected

- **IDs as text:** readable in `sqlite3`, but the Server converts for every view anyway.
- **Per-origin sequence numbers for sync:** the hybrid clock already orders each Machine's Events.
- **Separate occurred and recorded times for Events:** rarely different; a hook's own time goes into the payload.
- **Setup on first use of any command:** a Machine should be set up deliberately.
- **`deleted_at`:** duplicates `modified_at`.
- **Worktrees in the Registry:** they come and go and are discovered, not declared.
- **An ID file inside `.git` for Worktrees:** writes into the user's repository; identity by path suffices.
- **Separate tables for root commits and remotes:** matching scans a few hundred Checkouts at most.
- **A declared Repository URL:** duplicates origin; derived from the Clones' remotes.
- **Several database files (`ATTACH`) for grouping:** a transaction across them is not atomic in WAL mode.
- **rich for output:** slower startup, which matters for shell completion.
- **A single model module and an operations layer:** grows too large, and adds a layer without need.
- **A Python git library:** GitPython runs `git` underneath; pygit2 (libgit2) is a separate implementation that can disagree with the user's `git` and needs a compiled dependency on every Machine.
- **`clone add` creating Repositories:** mixes two responsibilities, for a rare convenience.

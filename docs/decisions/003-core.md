# 003: Core foundations

Status: accepted (2026-10-05)

## Context

The first slice needs the Core's foundations: storing Registry, State and Events, setting up a Machine, and observing Checkouts. Terminals, Launchers, plugins, Sync and the GUI come later; nothing here may block them.

## Package layout

One Python package (Python ≥ 3.12) with a single `pyproject.toml`, in the usual src layout. The parts from [002](002-technology-stack.md) are subpackages; `gui/` stays outside. A test checks that `core` imports none of the other parts.

```
src/hephaistos/
  core/
    ids.py        UUIDv7, hybrid logical clock
    paths.py      XDG directories, per-Machine subdirectory, filesystem type detection
    config.py     TOML
    db/           connection, schema, migrations
    registry/     machines.py, filesystems.py, repositories.py, checkouts.py
    state/        checkouts.py
    events/       storage and reading, kinds.py
    observers/    checkouts.py
    git.py        reads facts from git; knows nothing about our records
  cli/
  daemon/{watcher,sync,server}/
  plugins/
```

Each entity's dataclass lives next to its SQL. Operations spanning several modules (e.g. adding a Checkout: git facts, Repository, Checkout, Events) live with the entity they mainly concern; no separate operations layer.

## Setup and files

- `hephaistos setup` is required once per Machine. Every other command fails until then (except `--help` and `--version`); `setup` fails on a Machine that is already set up.
- Setup's core part is one transaction: directories, database, Machine record (named after the hostname), and its default Filesystem mounted at `/`. Later setup steps (hooks, autostart, remote setup) also exist as their own commands.
- Files follow XDG, always in a per-Machine subdirectory keyed by `/etc/machine-id` (hostname as fallback), so shared home directories need no configuration:
  - config: `~/.config/hephaistos/config.toml`, optional; built-in defaults apply.
  - data: `~/.local/share/hephaistos/<machine>/`
  - logs: `~/.local/state/hephaistos/<machine>/`, rotating files.
- SQLite runs in WAL mode, or with a rollback journal if the data directory is on a network filesystem (detected via `statfs`).
- A Machine set up twice (e.g. after deleting its data) gets a new ID; the same `os_machine_id` suggests merging them.

## Conventions

- **IDs:** UUIDv7, stored as 16 bytes.
- **Time:** a hybrid logical clock, stored as one INTEGER (milliseconds << 16 | counter). The clock lives in the database and advances inside each write transaction, so values from one Machine increase in commit order, across CLI and Daemon. Data received from Peers advances it past the largest value seen.
- **Column names:** `<verb>_at` for times, `<verb>_by` for the Machine that did it.
- **Registry tables** carry `modified_at`, `modified_by` and `deleted`. A deletion is an edit (its time is `modified_at`), and last write wins for edits and deletions alike. Uniqueness applies only to rows not deleted. Every change records an Event `<entity>.added`, `.changed` or `.deleted` with the new values.
- **Table names:** plural entity names; a relationship with a natural noun takes that noun (`mounts`).
- **Schema version:** `PRAGMA user_version`, with migrations.

## Tables

| Table | Category | Columns |
|---|---|---|
| `meta` | local | `key`, `value`: this Machine's ID, the clock |
| `machines` | Registry | `id`, `name`, `hostname`, `os_machine_id` |
| `filesystems` | Registry | `id`, `name` |
| `mounts` | Registry | `id`, `machine_id`, `filesystem_id`, `path` |
| `repositories` | Registry | `id`, `name` |
| `checkouts` | Registry | `id`, `repository_id`, `filesystem_id`, `path` (absolute), `kind` (clone / worktree), `clone_id` (worktrees only) |
| `checkout_state` | State | `checkout_id`, `observed_at`, `observed_by`, `present`, `head`, `branch` (NULL when detached), `root_commits` (JSON), `remotes` (JSON), `error` |
| `events` | Events | `id`, `recorded_at`, `recorded_by`, `kind`, `subject`, `priority`, `payload` (JSON) |

- A path's Filesystem is found through its mount (`/proc/self/mountinfo`); recognising shared Filesystems across Machines comes later.
- Remotes are stored without credentials and matched in normalised form. Worktrees take root commits and remotes from their clone.

## Events

- Kinds are a `StrEnum` in `events/kinds.py`, stored as dotted text (`checkout.branch_switched`); the prefix gives the subject's type. Kinds unknown to this version (from newer Peers) are kept and shown raw.
- One payload dataclass per kind; other related IDs go into the payload.
- Priority: low 10, normal 20, high 30, urgent 40. The origin sets it from a default per kind; high and above will be pushed right away.
- Later, with Agents: how an Event was captured, and whether it is reported or inferred.

## Observation

- An observer observes one kind of thing: it takes a snapshot, compares it with the stored State, and writes the changes and their Events through shared code. Observers know nothing about timing; the Watcher schedules them, with intervals per observer in its config.
- Each observation updates `observed_at`; rows and Events change only when something changed.
- First observer: `checkouts` (git).

## CLI for the first slice

One subcommand per entity, with the verbs `list`, `show`, `add`, `remove`, `rename`; a few top-level verbs act across entities.

```
hephaistos setup
hephaistos machine show
hephaistos repo add [path]          # suggests a matching Repository by root commits and remotes
hephaistos repo list
hephaistos checkout list
hephaistos event list
hephaistos observe [checkouts [--checkout <id>]]
hephaistos db tables | db dump <table>
```

Next: the Server and GUI pages showing these tables, plus a Repository overview.

## Rejected

- **IDs as text:** readable in `sqlite3`, but the Server converts for every view anyway.
- **Per-origin sequence numbers for sync:** the hybrid clock already orders each Machine's Events.
- **Separate occurred and recorded times for Events:** rarely different; a hook's own time goes into the payload.
- **Setup on first use of any command:** a Machine should be set up deliberately.
- **`deleted_at`:** duplicates `modified_at`.
- **Separate tables for root commits and remotes:** matching scans a few hundred Checkouts at most.
- **A declared Repository URL:** duplicates origin; derived from the Checkouts' remotes.
- **A single model module and an operations layer:** grows too large, and adds a layer without need.

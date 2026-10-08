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
    db/           connection, read and write sessions, schema, raw views
    registry/     machines.py, filesystems.py, mounts.py, repositories.py, clones.py
    state/        checkouts.py (shared by Clones and Worktrees), clones.py, worktrees.py
    events/       events.py (storage and reading), kinds.py, subjects.py
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
- Files follow XDG; data and logs are in a per-Machine subdirectory keyed by `/etc/machine-id` (hostname as fallback), so shared home directories need no configuration:
  - config: `~/.config/hephaistos/config.toml`, optional; built-in defaults apply. One file for all Machines sharing a home directory: settings at the top apply to all of them, a section `[machines.<hostname>]` (full, or its first part) overrides them on one.
  - data: `~/.local/share/hephaistos/<machine>/`
  - logs: `~/.local/state/hephaistos/<machine>/`, rotating files.
- The config file holds how this Machine runs (e.g. Daemon parts, SSH targets). Preferences shared by all Machines belong in the Registry, once it holds settings; until then `time_format` stays in the file.
- `HEPHAISTOS_HOME`, if set, puts config, data and logs into that one directory instead. Tests always use it, and so can experiments.
- SQLite runs in WAL mode, or with a rollback journal if the data directory is on a network filesystem (detected via `statfs`).
- A Machine set up twice (e.g. after deleting its data) gets a new ID; the same `os_machine_id` suggests merging them.

## Conventions

- **IDs:** UUIDv7, stored as 16 bytes.
- **Time:** a hybrid logical clock, stored as one INTEGER (milliseconds << 16 | counter). The clock lives in the database and advances inside each write transaction, so values from one Machine increase in commit order, across CLI and Daemon. Data received from Peers advances it past the largest value seen.
- **Column names:** `<verb>_at` for times, `<verb>_by` for the Machine that did it. JSON output uses the same names; text output drops the suffix (`recorded`).
- **Function names:** actions are verbs (`add`, `record`, `observe`); functions that only return something are named for what they return (`git.status`, `clones.details`, `caused_events`). Lookups and conversions may be verbs (`get`, `find`, `locate`, `parse_since`, `to_json`), and predicates read as questions (`is_network`, `shares_history`). Formatting helpers in the CLI end in `_text` or `_json`.
- **Registry tables** carry `modified_at`, `modified_by` and `deleted`. A deletion is an edit (its time is `modified_at`), and last write wins for edits and deletions alike. Uniqueness applies only to rows not deleted. Every change records an Event `<entity>.added` or `.deleted` with the record's values, or `.changed` with the changed fields' old and new values (in that shape, a kind may say more: `clone.moved`).
- **Table names:** prefixed with their category (`registry_`, `state_`), plus `events` and `meta`; plural entity names; a relationship with a natural noun takes that noun (`registry_mounts`). The code keeps a list of tables with their category, used by Sync and raw views.
- **Read and write sessions:** the Core opens the database either read-only (SQLite `mode=ro`) or as one write transaction, which advances the clock and records Events. Viewing (CLI `list` and `show`, the Server's read endpoints) only gets read sessions, so an accidental write fails.
- **Schema version:** `PRAGMA user_version`. Until the data is relied on, schema changes edit the initial schema, and an outdated database is reported with a clear message (`setup --reset` replaces it, keeping a backup; one-off scripts where data is worth keeping). Migrations start from a declared schema 1.

## Tables

| Table | Columns |
|---|---|
| `meta` | `key`, `value`: this Machine's ID, the clock |
| `registry_machines` | `id`, `name`, `hostname`, `os_machine_id` |
| `registry_filesystems` | `id`, `name` |
| `registry_mounts` | `id`, `machine_id`, `filesystem_id`, `path` |
| `registry_repositories` | `id`, `name` |
| `registry_clones` | `id`, `repository_id`, `filesystem_id`, `resolved_path`, `display_path` |
| `state_clones` | `clone_id`, `observed_at`, `observed_by`, `present`, `bare`, `head`, `branch` (NULL when detached), status (`upstream`, `ahead`, `behind`, `staged`, `changed`, `untracked`, `conflicted`; NULL when bare), `root_commits` (JSON), `remotes` (JSON), `branches` (JSON), `error`, `head_log` and `push_log` (reflog cursors) |
| `state_worktrees` | `id`, `clone_id`, `name` (git's), `path` (as git reports it), `lock_reason`, `observed_at`, `observed_by`, `present`, `head`, `branch`, status (as for Clones), `error`, `head_log`, `removed` |
| `events` | `id`, `recorded_at`, `recorded_by`, `kind`, `subject`, `priority`, `payload` (JSON), `occurred_at`, `key` |

- Names are unique per entity type (Machines, Filesystems, Repositories).
- A Repository is added by name. For a Clone that matches none, `clone add` suggests a name from the origin remote (`…/hephaistos.git` → `hephaistos`), else the directory.
- Paths: `resolved_path` has all symlinks resolved and is used for identity and comparison; `display_path` is the absolute path as typed, symlinks kept. Display shortens the home directory to `~`; Worktrees under their Clone show relative to it. A path's Filesystem is found through its mount (`/proc/self/mountinfo`); recognising shared Filesystems across Machines comes later.
- Remotes are stored without credentials and matched in normalised form (`git@host:a/b.git` and `https://host/a/b` are the same). Root commits are those of all local and remote-tracking branches. Worktrees share their Clone's root commits and remotes.
- A bare repository is a Clone whose path is its git directory; it has Worktrees but no files to open.
- Worktrees are identified by Clone and git's admin name (`<git common dir>/worktrees/<name>`), which survives `git worktree move` (`worktree.moved`); a new one gets a UUIDv7. One whose directory is gone was removed (`worktree.removed`; the row stays, marked `removed`, for its Events), unless locked with `git worktree lock`: then it is missing. If one of its name comes back with its reflog continuing where reading stopped (back from an unmounted filesystem, or moved by hand and repaired), it is that one again (`worktree.restored`). They sync as part of their Clone's snapshot, newest wins; observing keeps the locally known ID for a name, so Machines converge after one sync.

## Events

- Kinds are a `StrEnum` in `events/kinds.py`, stored as dotted text (`clone.branch_created`), in past tense: they are facts, while requests (later, e.g. `terminal.open`) are imperative; the prefix gives the subject's type. Kinds unknown to this version (from newer Peers) are kept and shown raw.
- The subject is always an ID. `events/subjects.py` maps each subject type to its module, which labels its subjects (e.g. a Repository by its current name; deleted records keep theirs). Subjects of unknown types show their short ID.
- Payloads: a Registry Event carries the record or its changes (see Conventions); other kinds have one payload dataclass each. Other related IDs go into the payload.
- Priority: low 10, normal 20, high 30, urgent 40. The origin sets it from a default per kind; high and above will be pushed right away.
- Conditions are facts about what one Machine sees. Git activity, and branches created or renamed, are facts about the repository, which several Machines may read on a shared Filesystem: they carry a `key` (16 bytes of SHA-256 over Clone, Worktree name, ref, git's time, and what changed). Others have none. With sync, an arriving Event whose key exists marks the one with the larger ID as a local `duplicate`, which views leave out.
- Events are never rewritten, one per fact; views group them: runs of one kind and subject (12 commits), a condition with its resolution (missing, then found), and chains (amends of a commit).
- `occurred_at`: when it happened, by its source's clock, in milliseconds; NULL where unknown, e.g. for conditions found between two observations. Git activity has git's time. `recorded_at` stays the order for sync.
- Later, with Agents: how an Event was captured, and whether it is reported or inferred.

## Observation

- An observer observes one kind of thing: it takes a snapshot and has the State compare it with what is stored, which writes the changes and records their Events. Observers know nothing about timing; the Watcher schedules them, with intervals per observer in its config.
- Each observation updates `observed_at`; rows and Events change only when something changed.
- First observer: `clones` (git), which also finds their Worktrees. git runs outside any transaction, several Clones in parallel, each command with a timeout; then one write session stores the results, keeping any State another process observed meanwhile. Commands run with `GIT_OPTIONAL_LOCKS=0`, so they never block the user's own.
- Conditions come from comparing State: `missing` and `found`, `failed` and `recovered` (when missing or failed, the rest stays as last known), branches created or deleted, remotes changed. Status counts, head and upstream only update State. File names are not stored: views of files ask the Machine's Server live.
- Git activity comes from git's reflogs (`git log --walk-reflogs`), read from a cursor per Checkout: the last entry read, by its time and a digest, so expiry doesn't move it; if its entry is gone, reading continues after its time. The first read starts at the end (`clone add` observes right away), or with `clone add --import-history` at the beginning; a Worktree found later starts at the beginning, as all of its reflog is new.
  - HEAD's reflog gives `committed` (also amends with the commit they replace, cherry-picks, reverts, `am`), `merged`, `pulled`, `rebased`, `reset`, `branch_switched`, and `head_moved` with git's message for what we can't name. A rebase folds into one Event; while one is in progress, it waits. Resets that don't move (`git stash`) are skipped.
  - Remote-tracking reflogs give `clone.pushed`; fetches are skipped. A new branch's reflog gives its creation time and start, or shows it was renamed (`clone.branch_renamed`, instead of deleted and created).
  - Reflog messages are git's text, stable in practice but unspecified; tests pin them with real git. Bare repositories keep no reflogs by default.
- Views show stored State with its age. `--refresh` observes first, in a separate write session. Views also observe first, saying so, when git knows a Checkout that the record misses, e.g. a Worktree not observed yet.

## CLI for the first slice

One subcommand per entity, with the verbs `list`, `show`, `add`, `remove`, `rename`; a few top-level verbs act across entities. Entities are addressed by name, Checkouts by path (`.` by default; the innermost Checkout containing it), and entities without a name by a short ID (the end of the UUID). Worktrees can also be addressed by name, asking if several Clones have one. `clone` commands accept a path in one of the Clone's Worktrees, except `clone remove`.

```
hephaistos setup
hephaistos machine list | show
hephaistos repo list | show <name> | add <name> | rename <name> <new name>
                | remove <name> [--clones] [--yes]
hephaistos clone add [path] [--repo <name>] [--import-history]
hephaistos clone list [--repo <name>] [--refresh] | show [--refresh] | remove
                 | move <old> <new> [--nested]
hephaistos worktree list [--repo <name>] [--refresh] | show [path|name] [--refresh]
hephaistos event list [--kind <kind>] [--priority <min>] [--machine <name>] [--since <when>]
                     [--repo <name>] [--clone <path>] [--worktree <path|name>] | show <id>
hephaistos observe [clones] [--clone <path>]…
hephaistos scan [dir] [--depth <n>] [-v] [--yes] [--import-history]
hephaistos db tables | dump <table> [-c <column>]… [--table|--blocks] [--short-ids]
```

- `clone add` attaches to an existing Repository only. If the Clone matches Repositories (root commits, remotes), it asks in a terminal; without one, it requires `--repo`. Without a match, it fails and suggests `scan`, which adds a new Repository with it. It refuses a Clone that shares no root commit with the Repository's other Clones (such Repositories don't count as matches either), a path inside a Worktree (the message names its Clone), and a submodule (its superproject is the Clone).
- `repo remove` refuses while the Repository has Clones; `--clones` also removes them, on every Machine, after asking. `clone remove` says when it leaves a Repository without Clones.
- `clone move` records a move already made on disk; the Clone keeps its ID and history. The old path must no longer be a repository, and the new one must share the Clone's history. It refuses while links to its Worktrees are broken (an observation would take them as removed), printing the `git worktree repair` command. Clones inside it move along with `--nested`, all or nothing; without it, their commands are printed.
- Asking happens between a read and a write session, so no write transaction waits for input.
- `scan` adds the clones under a directory (3 levels by default) in one transaction, after showing the plan and asking once: each joins the Repository it matches, else a Repository without Clones by name, else a new one; clones found together match each other too. A new Repository is named after the first of its clones' remotes that isn't a local path, else as `clone add` suggests. A Worktree brings its Clone, wherever that is, and one not observed yet has its Clone observed. It stops at clones without searching inside them, skips hidden directories, follows symlinks (preferring real paths), and refuses to start inside a Clone or at a submodule. A clone that may be a missing Clone, moved, is skipped with the commands for either. Nothing is guessed: a clone matching several Repositories, or whose new Repository's name is taken, is skipped with the commands to add it by hand.
- `event list` shows the newest 20 (`--limit`), each with a summary of its payload. `--repo` includes Events about its Clones and their Worktrees, `--clone` those about its Worktrees. `--kind` takes a kind, its leading parts (`clone`), or a glob (`'*.deleted'`), and repeats; `--since` takes a duration (`2h`) or a date.
- Output: plain aligned text; `--json` on `list` and `show`. Times are relative in lists (`now`, `3m`, `2h`, `5d`), full in `show` (`2026-10-05 14:03:21`), ISO 8601 in JSON; `--time-format relative|short|full` and `time_format` in the config override this. `short` is `14:03` today, `10-05 14:03` this year, else `2025-10-05`.
- Common options have one-letter short forms (`-r`, `-k`, `-n`).
- `db` shows tables as stored, newest first, also an outdated database (with a warning) and tables this version doesn't know. The module owning a table declares how to decode each column (`DECODERS`: IDs, clock values, JSON); a test holds these to the schema. Columns of unknown or outdated tables are decoded by name where all tables agree, else shown as stored. All columns show one line per value, chosen columns (`-c`) one line per row.

Next: the Server and GUI pages showing these tables, plus a Repository overview.

## Rejected

- **IDs as text:** readable in `sqlite3`, but the Server converts for every view anyway.
- **Per-origin sequence numbers for sync:** the hybrid clock already orders each Machine's Events.
- **Setup on first use of any command:** a Machine should be set up deliberately.
- **`deleted_at`:** duplicates `modified_at`.
- **Worktrees in the Registry:** they come and go and are discovered, not declared.
- **An ID file inside `.git` for Worktrees:** writes into the user's repository; git's admin name suffices.
- **Separate tables for root commits and remotes:** matching scans a few hundred Checkouts at most.
- **A declared Repository URL:** duplicates origin; derived from the Clones' remotes.
- **Several database files (`ATTACH`) for grouping:** a transaction across them is not atomic in WAL mode.
- **rich for output:** slower startup, which matters for shell completion.
- **A single model module and an operations layer:** grows too large, and adds a layer without need.
- **A Python git library:** GitPython runs `git` underneath; pygit2 (libgit2) is a separate implementation that can disagree with the user's `git` and needs a compiled dependency on every Machine.
- **`clone add` creating Repositories:** mixes two responsibilities, for a rare convenience.

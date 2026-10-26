# 003: Core foundations

Status: accepted (2026-10-05)

## Context

The first slice needs the Core's foundations: storing Registry, State and Events, setting up a Machine, and observing Checkouts.
Terminals, Launchers, plugins, Sync and the GUI come later; nothing here may block them.

This ADR records the decisions that are costly to change.
How things work on them is described in [docs/core/](../core/): [setup](../core/setup.md), [settings](../core/settings.md), [data](../core/data.md), [events](../core/events.md), [observation](../core/observation.md) and [logs](../core/logs.md); also in [docs/daemon/](../daemon/), [docs/cli/](../cli/commands.md) and [development](../development.md).

## Decision

- **One package:** one Python package with a src layout; the parts from [002](002-technology-stack.md) are its subpackages, and `gui/` stays outside. A test checks what each part imports: the Core none of the others, the Daemon and the Desktop only the Core, the CLI any. Each entity's dataclass lives next to its SQL. An operation spanning several modules lives with the entity it mainly concerns; there is no operations layer.
- **Setup:** `hephaistos setup` is required once per Machine, so a Machine is set up deliberately. Every other command fails until then.
- **Files:** XDG directories. Data and logs are in a per-Machine subdirectory, keyed by `/etc/machine-id`, so home directories shared by several Machines need no configuration. `HEPHAISTOS_HOME` puts everything into one directory instead, for tests and experiments. Only the user may enter the data and log directories, as clusters often open home directories to others.
- **Settings:** layers, each overriding the ones before it key by key: shipped defaults, later Registry settings, `config.toml`, `config.<hostname>.toml`, environment variables, command-line options. TOML, where every setting has a real value and never null. Files hold how this Machine runs; preferences shared by all Machines will belong in the Registry. Each process loads its settings once, at startup.
- **IDs:** UUIDv7, stored as 16 bytes.
- **Time:** a hybrid logical clock, stored as one INTEGER. It lives in the database and advances inside each write transaction, so values from one Machine increase in commit order, across CLI and Daemon.
- **Registry edits:** last write wins, for edits and deletions alike; a deletion is an edit (`deleted`). Every change records an Event with the record's values or the changed fields.
- **Table categories:** each table belongs to a category (`registry_`, `state_`, plus `events` and `meta`), which Sync and raw listings use.
- **Read and write sessions:** the Core opens the database either read-only or as one write transaction. Viewing only gets read sessions, so an accidental write fails.
- **No migrations until releases:** the schema version is `PRAGMA user_version`, with a hash of the schema in `meta`. Schema changes edit the schema itself; one-off scripts carry data worth keeping, or `setup --reset` replaces the database.
- **Names and paths:** a Repository's name is as GitHub's, compared ignoring case, so a name is never a path. A Clone is identified by its path with all symlinks resolved, and shown by its path as typed.
- **Worktrees:** observed, not registered; identified by their Clone and git's admin name, which survives `git worktree move`.
- **Events:** facts, never rewritten, named in the past tense by dotted kinds whose prefix gives the subject's type. The subject is always an ID. Facts about a repository that several Machines may read carry a key, so that Sync can find duplicates.
- **Observation:** an observer takes a snapshot, and the State compares it with what is stored, writing the changes and recording their Events. Observers know nothing about timing. git runs outside any transaction, and never takes optional locks. Git activity comes from git's reflogs, read from a cursor per Checkout and reflog.
- **Logs:** local diagnostics about hephaistos itself, as JSON Lines, one file per UTC day. They are never synced, and nothing reads them to decide anything; Events stay the record of work.
- **Daemon:** one per Machine, held by a lock; installed as a systemd user unit, else run in tmux.
- **CLI:** one subcommand per entity, with the verbs `list`, `show`, `register`, `unregister` and `rename`, as the Registry only declares what is on disk, never creating or deleting it. A few top-level verbs act across entities. Entities are addressed by name, Checkouts by path, others by a short ID. Output is plain aligned text; `--json` on `list` and `show` gives the Server's JSON.

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

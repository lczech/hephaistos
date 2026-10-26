# Setup

How a Machine is set up, and where hephaistos keeps its files ([ADR 003](../decisions/003-core.md)).

## Setting up

`hephaistos setup` is required once per Machine.
Every other command fails until then, except `--help` and `--version`.
Run again, `setup` keeps the database and updates the other parts.
Its core part is one transaction: directories, database, the Machine's record (named after the hostname), and its default Filesystem mounted at `/`.
Its other parts are commands of their own, which it runs after the core part: `daemon install` and, in a graphical session, `desktop install`.
`--no-daemon` and `--no-desktop` skip them.
A part that fails is skipped with a warning naming its command.
A Machine set up twice, e.g. after deleting its data, gets a new ID; the same `os_machine_id` suggests merging the two.

## Chassis

A Machine's chassis comes from `hostnamectl chassis`, or from `Chassis:` in `hostnamectl status` before systemd 249.
The setting `machine.chassis` overrides it.
It is stored at setup and updated when the Daemon starts (`machine.changed`).

## Files

Files follow XDG.
Data and logs are in a per-Machine subdirectory, keyed by `/etc/machine-id`, with the hostname as fallback.
So home directories shared by several Machines need no configuration.
- config: `~/.config/hephaistos/`, optional files ([settings](settings.md));
- data: `~/.local/share/hephaistos/<machine>/`;
- logs: `~/.local/state/hephaistos/<machine>/`, one file per UTC day, e.g. `2026-10-08.jsonl` ([logs](logs.md)).

`HEPHAISTOS_HOME`, if set, puts config, data and logs into that one directory instead.
Tests always set it, and so can experiments.

Only the user may enter the data and log directories (mode 0700), as home directories on clusters are often open to others.
Each run makes them so, warning once, and refuses directories that belong to another user.
Symlinks are followed, e.g. to data on a local disk.
The config directory is left as the user keeps it.

## Database file

SQLite runs in WAL mode.
On a network filesystem, detected via `statfs`, it uses a rollback journal instead, as WAL needs shared memory between processes on one host.

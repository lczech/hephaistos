# Daemon

How the Daemon runs its parts, and how it is installed and checked ([ADR 002](../decisions/002-technology-stack.md), [ADR 003](../decisions/003-core.md)).
Its parts: the [Watcher](watcher.md) and the [Server](server.md); later Sync.

## Running

`hephaistos daemon run` runs the parts this Machine enables, in the foreground, until SIGINT or SIGTERM.
The Watcher's timer runs unless `watcher.interval` is 0; the Server runs if `server.enabled`.
systemd runs the Daemon this way.
One Daemon runs per Machine: it holds an exclusive `flock` on `daemon.lock` in the state directory, which the kernel releases however it ends.
A crashed part restarts after 1 s, doubling up to 60 s, and back to 1 s once it ran for 10 minutes.
A Daemon that can't start exits with 78 (`EX_CONFIG`), which its systemd unit doesn't restart.
That is the case with a broken config, nothing to do, no setup, no git, or a Daemon already running.

## Stopping

Stopping is immediate.
A pass cut short loses nothing, as git only reads and SQLite rolls back; requests waiting for it get 503.
The Server then stops as uvicorn does: open requests finish within 3 s, and live connections close with 1012.
A second signal exits at once.

## Its file

`daemon.json` in the state directory tells how the Daemon runs:
- its pid;
- its version, from a checkout with its commit, e.g. `0.1.0 (bfc66f6-dirty)`;
- its start and stop;
- the Watcher's last pass: when, how long, any error, and what asked for it;
- the Server's address and counts of requests.

It is written at most every 2 s, replaced as a whole and never half written.
A start that finds no stop time logs that the previous Daemon ended without stopping.

## Log

- INFO: start (parts, interval, git and its version), stop, and passes that record Events.
- DEBUG: passes that record none.
- ERROR: failed passes and crashes.

Passes say what asked for them: `trigger` is `watcher` or `api`.

## Installing

`daemon install` writes a systemd user unit, `~/.config/systemd/user/hephaistos.service`, then enables and starts it.
The unit runs the hephaistos that installed it, by the path it was run as.
A link such as `~/.local/bin/hephaistos` survives reinstalling the tool.
The unit gets the shell's `HEPHAISTOS_HOME` and XDG directories.
Settings variables don't reach it, and `install` says so.
Run again, `install` rewrites a changed unit and restarts the Daemon; it leaves alone a unit it didn't write.
`--linger` runs `loginctl enable-linger`, so the Daemon starts at boot and survives logout.
`uninstall` leaves linger as it is.

## Starting and stopping

`start`, `stop` and `restart` go through systemd.
`stop` also ends a Daemon run by hand, sending SIGTERM to the lock's holder.
`start` refuses while one runs.
Without systemd user services, `daemon run` in tmux takes their place.

## Status

`daemon status` shows:
- the unit;
- the Daemon, from the lock and `daemon.json`;
- the last pass, and what asked for it;
- the Watcher's timer: `stalled` if the last pass is more than 3 intervals plus `git.timeout` ago;
- the Server.

It warns if the unit's program is gone, or its paths differ from the shell's.
It exits with 0 if the Daemon runs, 3 if not.
`--json` gives what the Server's `/api/daemon` gives.

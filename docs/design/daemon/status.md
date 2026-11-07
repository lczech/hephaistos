# Status

How this Machine's setup is checked, and what `hephaistos status` and the Server's `/api/status` show: the checks, what runs, and the log's recent warnings and errors.

## Checks

A check finds one thing ok, a problem, or a note.
A problem stops or degrades a feature until the user changes something: installs, upgrades, reinstalls or changes a setting; it says what to do.
A note is a choice that is fine, e.g. no systemd on a cluster, or the Daemon run by hand.
What goes wrong for a while, e.g. a failed pass or a lost connection, isn't a check: the Daemon's status shows it ([Daemon](daemon.md#status)).

The checks, in `daemon/checks.py`, each part adding its own:
- git: found on the PATH, and its version; a problem without it.
- SQLite: Python's, at least 3.37.
- systemd: its version; a note without user services.
- The unit, with systemd: a note if not installed or disabled; a problem if a unit of another installation is in the way, its program is gone, or it uses other directories than those of this process.
- Linger, with the unit enabled: a problem if off, as the Daemon then stops at logout.
- ionice: a note if missing, as passes then run at normal I/O priority.

The checks run in the process that asks, as the PATH may differ: in the Daemon for the GUI, in the shell for the CLI.
They cost a few `--version` calls and systemd queries, so nothing runs them on a timer.
The Daemon runs them at its start, and each time a client asks `/api/status`.
It records them in `daemon.json`, with the time, and logs those that changed: problems as warnings, the others as info.
`/api/daemon` gives the recorded ones, for the status bar, so that it doesn't run them.

## About

What runs, and on what, for reporting an issue:
- hephaistos's version, with its commit from a checkout, e.g. `0.1.0 (bfc66f6-dirty)`;
- the API's version and the database's schema;
- the versions of Python, SQLite, git and systemd;
- the OS, the kernel, the desktop, the locale and the time zone.

A Daemon under systemd starts before any desktop, so it takes the desktop and locale from systemd's user environment where its own lacks them.
The time zone comes from `TZ`, else from where `/etc/localtime` links to.
It leaves out what identifies the user: paths, the Machine's name, settings.

## Log

The log's warnings and errors of the last 24 hours are counted, errors including critical ones, from both kinds of process.

## The command

`hephaistos status` prints its own checks, under "Setup, checked in this shell".
While the Daemon runs, the problems and notes it recorded that the shell's checks lack follow, with when it ran them, e.g. git missing from its PATH.
Then come the lines of `daemon status`, About, and the log's counts, naming the `log show` that lists them.
`--json` gives what `/api/status` gives: the checks, About, the log's counts, and `daemon status --json`.
It runs on the default settings if the config is broken, to look into that.

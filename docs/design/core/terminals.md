# Terminals

How the Core keeps Terminals alive and observes them ([ADR 002](../../decisions/002-technology-stack.md)).

## The Keeper

The Keeper holds the process of each Terminal and its output while nothing shows it.
The Core uses it through a small interface (`core/terminals/keeper.py`): check that it can run, list its sessions, create, adopt, rename and kill one.
It knows nothing of the database.
tmux is the only Keeper (`core/terminals/tmux.py`).

The snapshot of a session has the ID of its Terminal (none until adopted), its name, where it started, the current directory and program of its foreground process, the clients attached, when it was created and last active, and how many panes it has.

## tmux

Each Terminal is one tmux session with one pane.
Its ID is a session option, `@hephaistos_id`, set by the same command list that creates the session, so no one sees it without one.
The programs in each Terminal find its ID in `HEPHAISTOS_TERMINAL`.
Renaming and killing target a session by the ID tmux gives it (`$3`), found by its name, as tmux may print a name otherwise than it takes it.
tmux reads some arguments specially, so each holding a name, a path or a value is written to be taken literally: one ending in `;` would end the command (`\;`), and a `#` in a name or directory starts a format (`##`).
tmux refuses a name that is taken, which settles races between creators.

### Socket and config

All our tmux commands use a socket of our own, `tmux -L hephaistos`, apart from the tmux of the user.
With `HEPHAISTOS_HOME` set, the socket gets a name unique to that directory, so tests and scratch Daemons never see the real Terminals.
`terminals.tmux.socket` names another; `terminals.tmux.path` names the tmux to run, e.g. one installed without root where the system tmux is older.

Every command passes our config with `-f`, so `~/.tmux.conf` never applies on our socket.
The config is generated from the settings and written to the state directory.
It makes tmux a plain terminal:
- no status bar;
- `xterm-256color`, with 24-bit colour (`COLORTERM=truecolor`);
- extended keys (e.g. Shift+Enter) and focus events;
- a short escape time, so Esc does not lag;
- the server staying after its last session, so that no server means it crashed or was killed;
- `history-limit` from `terminals.history`;
- none of the tmux keys but Ctrl+B d (detach), Ctrl+B [ and PageUp (copy mode), and Ctrl+B Ctrl+B (a Ctrl+B for the program).

It ends with a marker, `@hephaistos_config`, the hash of its text.
Listing the sessions finds a server whose marker differs, e.g. one started by hand or before a settings change, and loads our config into it.

### Scopes

systemd stops a unit by killing its whole cgroup, and systemd-oomd kills whole cgroups under memory pressure.
A process stays in the cgroup of the process that forked it, however it detaches.
So where the systemd user manager answers, the tmux server starts in a scope of its own (`systemd-run --user --scope`), and the process of each Terminal in another, `hephaistos-terminal-<id>.scope`.
A tmux built with systemd support, e.g. that of Ubuntu, also moves each new pane into a scope of its own, `tmux-spawn-*.scope`, while the pane starts; whichever move comes last holds it.
Stopping the Daemon, or an out-of-memory kill of one Terminal, ends no other.
Elsewhere, e.g. on clusters, both start as plain processes.
A user manager that does not answer within 5 s, e.g. under heavy load, is logged as a warning, and the Terminal starts without a scope of its own.

### Environment

Where systemd answers, the server starts with the environment of the user manager, as a terminal emulator on a desktop does.
Elsewhere it has the environment of the process that starts it.
A new Terminal also gets the variables of its creator that a terminal emulator passes on (`DISPLAY`, `WAYLAND_DISPLAY`, `SSH_AUTH_SOCK`, …), and runs the login shell of the creator unless given a command.
tmux sets `TMUX` and `TMUX_PANE` for each program it starts; each Terminal starts through `env -u`, which removes them, then becomes the program.
So a `tmux` typed in a Terminal reaches the tmux of the user, as from any terminal emulator, and programs see no sign of tmux.

### Listing

One `list-panes -a` lists all sessions, each as its first pane, counting the others.
tmux prints paths as they are, tabs and newlines included; some builds, e.g. 3.4 on Ubuntu, write other control characters, bytes that are not UTF-8 and `$` as escapes (`\037`, `\b`, `\$`), but a backslash as itself.
So fields are separated by a tab, a Unit Separator and a tab, escaped or not, and each pane ends with a Record Separator.
The escapes in a path count where the path so read exists and the text as printed does not.
tmux runs with `-u`, else without a UTF-8 locale, e.g. in a Daemon, it prints `_` for each character beyond ASCII; its output is decoded as bytes, as text mode would turn a `\r` into a `\n`.
A pane whose fields do not add up is skipped and logged, never misread; so is a session without a name, which tmux 3.8 makes of `new -s '#'`.
Without a server, there are no sessions.

### Killing

Killing a Terminal ends its session, and its processes get SIGHUP.
What ignores SIGHUP outlives it.
`force` sends SIGKILL first, to the scope the process of the Terminal runs in, never that of the server, and to every process in the session of its pane.

### Versions

Terminals need tmux 3.2a or later; an older one or none fails with a message naming `terminals.tmux.path`.
A version we cannot read, e.g. `master`, counts as new enough, and is logged.
`hephaistos status` and the Status View check tmux too, before any Terminal is made ([status](../daemon/status.md#checks)).
The tests run with every minor version since 3.2a ([development](../../development.md#tests)).

## Observing

Each Machine stores its Terminals in `state_terminals` ([data](data.md)), as the Keeper last showed them; the Watcher observes them in each pass.
The Keeper runs outside any transaction, then one write session compares its sessions with the rows.
A row observed after the Keeper was asked, e.g. of a Terminal another process created meanwhile, is a newer reading: it stays as it is, as those of Clones do ([observation](observation.md)).

A Terminal is **open** while its session runs, and **lost** once it cannot run any more:
- its session gone, the server running in the same boot: it ended, e.g. its shell exited, and its row goes;
- the server gone in the same boot: it crashed or was killed, so its Terminals are lost;
- another boot (by the Linux boot ID): they are lost too.

Lost ones keep their row and name, to be restored with both, or killed.
Terminals record no Events ([ADR 001](../../decisions/001-data-ownership.md)).

A session without an ID, e.g. one started by hand on our socket, is adopted: it gets one and a row.
So does one whose ID is not valid, or is that of another session.
One named like a lost Terminal takes the ID of that one, so that `tmux -L hephaistos new -s api` after a reboot brings `api` back.
tmux compares and sets the ID in one command, so two processes adopting at once agree on it.

Names are unique per Machine, lost Terminals included.
A Terminal renamed by hand to the name of another takes it; the other moves to a free name, e.g. `api-1`.
Names hephaistos gives have ASCII letters, digits, `-` and `_`, at most 64, not starting with `-`; adopted ones keep their name in tmux, whatever it is.
The default name of a new Terminal is that of its directory, numbered from 1: `hephaistos-1`, `hephaistos-2`.

Without a working Keeper, e.g. without tmux, a Machine without Terminals is no news; with some, it is logged and a problem of the pass ([Watcher](../daemon/watcher.md#failures)), and their rows stay as they were, their age showing it.

## Actions

Creating, renaming and killing a Terminal (`core/terminals/actions.py`) serve the CLI and, later, the Server.
Each observes first, so that it acts on what the Keeper holds now, then acts on the Keeper, then observes again: State comes from the one comparison.
A lost Terminal has no session, so renaming or killing one changes its row alone; killing forgets it.

A new Terminal starts in an existing directory we can enter, stored with symlinks resolved, whose path is UTF-8, as text in the database is.
Names and paths only observed, e.g. after a `cd`, are stored with U+FFFD (�) for bytes that are not UTF-8, so that they never stop an observation.
A name given that is taken, by an open or lost Terminal or by a session not observed yet, is refused.
A default name that another process takes meanwhile moves on to the next free number.
A command that ends before the Terminal is observed is reported as having ended at once; a server that ends meanwhile, as lost at once.


# Terminals

How the Core keeps Terminals alive and observes them ([ADR 002](../decisions/002-technology-stack.md)).

## The Keeper

The Keeper holds each Terminal's process and its output while nothing shows it.
The Core uses it through a small interface (`core/terminals/keeper.py`): check that it can run, list its sessions, create, adopt, rename and kill one.
It knows nothing of the database.
tmux is the only Keeper (`core/terminals/tmux.py`).

A session's snapshot has the Terminal's ID (none until adopted), its name, where it started, the current directory and program of its foreground process, the clients attached, when it was created and last active, and how many panes it has.

## tmux

Each Terminal is one tmux session with one pane.
Its ID is a session option, `@hephaistos_id`, set by the same command list that creates the session, so no one sees it without one.
Each Terminal's programs find its ID in `HEPHAISTOS_TERMINAL`.
Targets name sessions exactly (`=name`), as tmux otherwise also matches a prefix.
tmux refuses a name that is taken, which settles races between creators.

### Socket and config

All our tmux commands use a socket of our own, `tmux -L hephaistos`, apart from the user's tmux.
With `HEPHAISTOS_HOME` set, the socket gets a name of that directory's own, so tests and scratch Daemons never see the real Terminals.
`terminals.tmux.socket` names another; `terminals.tmux.path` names the tmux to run, e.g. one installed without root where the system's is older.

Every command passes our config with `-f`, so `~/.tmux.conf` never applies on our socket.
The config is generated from the settings and written to the state directory.
It makes tmux a plain terminal:
- no status bar;
- `xterm-256color`, with 24-bit colour (`COLORTERM=truecolor`);
- extended keys (e.g. Shift+Enter) and focus events;
- a short escape time, so Esc doesn't lag;
- the server staying after its last session, so that no server means it crashed or was killed;
- `history-limit` from `terminals.history`;
- none of tmux's keys but Ctrl+B d (detach), Ctrl+B [ and PageUp (copy mode), and Ctrl+B Ctrl+B (a Ctrl+B for the program).

It ends with a marker, `@hephaistos_config`, the hash of its text.
Listing the sessions finds a server whose marker differs, e.g. one started by hand or before a settings change, and loads our config into it.

### Scopes

systemd stops a unit by killing its whole cgroup, and systemd-oomd kills whole cgroups under memory pressure.
A process forked by another stays in that one's cgroup, however it detaches.
So where systemd's user manager answers, the tmux server starts in a scope of its own (`systemd-run --user --scope`), and each Terminal's process in another, `hephaistos-terminal-<id>.scope`.
A tmux built with systemd support, e.g. Ubuntu's, also moves each new pane into a scope of its own, `tmux-spawn-*.scope`, while the pane starts; whichever move comes last holds it.
Stopping the Daemon, or an out-of-memory kill of one Terminal, ends no other.
Elsewhere, e.g. on clusters, both start as plain processes.

### Environment

Where systemd answers, the server starts with the user manager's environment, as a desktop's terminal emulator does.
Elsewhere it has its starter's.
A new Terminal also gets its creator's variables that a terminal emulator passes on (`DISPLAY`, `WAYLAND_DISPLAY`, `SSH_AUTH_SOCK`, …), and runs the creator's login shell unless given a command.

### Listing

One `list-panes -a` lists all sessions, each as its first pane, counting the others.
tmux prints paths as they are, tabs and newlines included; newer versions write other control characters as octal escapes.
So fields are separated by a tab, a Unit Separator and a tab, escaped or not, and each pane ends with a Record Separator.
A pane whose fields don't add up is skipped and logged, never misread.
Without a server, there are no sessions.

### Killing

Killing a Terminal ends its session, and its processes get SIGHUP.
What ignores SIGHUP outlives it.
`force` sends SIGKILL first, to the scope the Terminal's process runs in, never the server's, and to every process in its pane's session.

### Versions

Terminals need tmux 3.2a or later; an older one or none fails with a message naming `terminals.tmux.path`.
A version we can't read, e.g. `master`, counts as new enough, and is logged.
`hephaistos status` and the Status View check tmux too, before any Terminal is made ([status](../daemon/status.md#checks)).
The tests run with every minor version since 3.2a ([development](../development.md#tests)).

## Observing

Each Machine stores its Terminals in `state_terminals` ([data](data.md)), as the Keeper last showed them; the Watcher observes them in each pass.
The Keeper runs outside any transaction, then one write session compares its sessions with the rows.
A row observed after the Keeper was asked, e.g. of a Terminal another process created meanwhile, is a newer reading: it stays as it is, as Clones' do ([observation](observation.md)).

A Terminal is **open** while its session runs, and **lost** once it can't run any more:
- its session gone, the server running in the same boot: it ended, e.g. its shell exited, and its row goes;
- the server gone in the same boot: it crashed or was killed, so its Terminals are lost;
- another boot (Linux's boot ID): they are lost too.

Lost ones keep their row and name, to be restored with both, or killed.
Terminals record no Events ([ADR 001](../decisions/001-data-ownership.md)).

A session without an ID, e.g. one started by hand on our socket, is adopted: it gets one and a row.
So does one whose ID isn't valid, or is another session's.
One named like a lost Terminal takes that one's ID, so that `tmux -L hephaistos new -s api` after a reboot brings `api` back.
tmux compares and sets the ID in one command, so two processes adopting at once agree on it.

Names are unique per Machine, lost Terminals included.
A Terminal renamed by hand to another's name takes it; the other moves to a free name, e.g. `api-1`.
Names hephaistos gives have ASCII letters, digits, `-` and `_`, at most 64, not starting with `-`; adopted ones keep tmux's name, whatever it is.
A new Terminal's default name is its directory's, numbered from 1: `hephaistos-1`, `hephaistos-2`.

Without a working Keeper, e.g. without tmux, a Machine without Terminals is no news; with some, it is logged and a problem of the pass ([Watcher](../daemon/watcher.md#failures)), and their rows stay as they were, their age showing it.

## Actions

Creating, renaming and killing a Terminal (`core/terminals/actions.py`) serve the CLI and, later, the Server.
Each observes first, so that it acts on what the Keeper holds now, then acts on the Keeper, then observes again: State comes from the one comparison.
A lost Terminal has no session, so renaming or killing one changes its row alone; killing forgets it.

A new Terminal starts in an existing directory we can enter, stored with symlinks resolved.
A name given that is taken, by an open or lost Terminal or by a session not observed yet, is refused.
A default name that another process takes meanwhile moves on to the next free number.
A command that ends before the Terminal is observed is reported as having ended at once.


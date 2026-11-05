# Terminals

How the Core keeps Terminals alive ([ADR 002](../decisions/002-technology-stack.md)).

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
- `history-limit` from `terminals.history`;
- none of tmux's keys but Ctrl+B d (detach), Ctrl+B [ and PageUp (copy mode), and Ctrl+B Ctrl+B (a Ctrl+B for the program).

It ends with a marker, `@hephaistos_config`, the hash of its text.
Listing the sessions finds a server whose marker differs, e.g. one started by hand or before a settings change, and loads our config into it.

### Scopes

systemd stops a unit by killing its whole cgroup, and systemd-oomd kills whole cgroups under memory pressure.
A process forked by another stays in that one's cgroup, however it detaches.
So where systemd's user manager answers, the tmux server starts in a scope of its own (`systemd-run --user --scope`), and each Terminal's process in another, `hephaistos-terminal-<id>.scope`.
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
Without a server, there are no sessions; the server ends with its last one.

### Killing

Killing a Terminal ends its session, and its processes get SIGHUP.
What ignores SIGHUP outlives it.
`force` sends SIGKILL first, to the Terminal's scope and to every process in its pane's session.

### Versions

Terminals need tmux 3.2a or later; an older one or none fails with a message naming `terminals.tmux.path`.
A version we can't read, e.g. `master`, counts as new enough, and is logged.
The tests run with every minor version since 3.2a ([development](../development.md#tests)).

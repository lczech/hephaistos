# Terminals

How the Core keeps Terminals alive and observes them ([ADR 002](../../decisions/002-technology-stack.md)).

## The Keeper

The Keeper holds the process of each Terminal and its output while nothing shows it.
The Core uses it through a small interface (`core/terminals/keeper.py`): check that it can run, list its sessions, create, adopt, rename and kill one.
It knows nothing of the database.
tmux is the only Keeper (`core/terminals/tmux.py`).

The snapshot of a session has the ID of its Terminal (none until adopted), its name, where it started, the current directory and program of its foreground process, the clients attached, when it was created and last active, how many panes it has, and how its program ended, if it did.

## tmux

Each Terminal is one tmux session with one pane.
Its ID is a session option, `@hephaistos_id`, set by the same command list that creates the session, so no one sees it without one.
The programs in each Terminal find its ID in `HEPHAISTOS_TERMINAL`.
It is a hint, never proof that a process runs in that Terminal: it spreads beyond it, e.g. into a tmux of the user whose server started inside it, and from there into every later session of that server.
What runs in a Terminal is told by state, e.g. by its tty or processes.
Renaming and killing target a session by the ID tmux gives it (`$3`), found by its name, as tmux may print a name otherwise than it takes it.
tmux reads some arguments specially, so each holding a name, a path or a value is written to be taken literally: one ending in `;` would end the command (`\;`), and a `#` in a name or directory starts a format (`##`), except in a run of them before `[`, which tmux keeps as it is.
tmux refuses a name that is taken, which settles races between creators.
A failed command is told apart by state, never by the message of tmux: whether the server answers on its socket, whether the session is still listed, whether the name is taken ([development](../../development.md#principles)).

### Socket and config

All our tmux commands use a socket of our own, `tmux -L hephaistos`, apart from the tmux of the user.
With `HEPHAISTOS_HOME` set, the socket gets a name unique to that directory, so tests and scratch Daemons never see the real Terminals.
`terminals.tmux.socket` names another; `terminals.tmux.path` names the tmux to run, e.g. one installed without root where the system tmux is older.

Every command passes our config with `-f`, so `~/.tmux.conf` never applies on our socket: a config of the user could change what the GUI shows, e.g. the terminal programs see, or restore sessions of its own by a plugin.
The config is generated from the settings and written to the state directory.
It keeps the defaults of tmux, its status bar and keys included, so that attaching from the CLI is plain tmux; a client in control mode, as the GUI uses, shows no status bar and runs no key bindings.
On top, only what the server needs:
- `xterm-256color`, with 24-bit colour (`COLORTERM=truecolor`), as in GNOME Terminal: in the GUI, programs write to xterm.js and get its keys, and `ssh` from a Terminal finds the terminfo on any host, unlike that of `tmux-256color`;
  attached from the CLI, tmux draws and sends keys as itself, e.g. Home and End as `\E[1~` and `\E[4~`, not as `xterm-256color` says (`\EOH`, `\EOF`), so a program that takes them from terminfo alone misses them there;
- extended keys (e.g. Shift+Enter) and focus events;
- a short escape time, so Esc does not lag;
- the server staying after its last session, so that no server means it crashed or was killed;
- `history-limit` from `terminals.history`;
- `update-environment` with the variables of a desktop session, see below;
- `remain-on-exit`, and a hook for panes that end, see below.

It ends with a marker, `@hephaistos_config`, the hash of its text.
Listing the sessions finds a server whose marker differs, e.g. one started by hand or before a settings change, and loads our config into it.

### Ends

A Terminal ends as a terminal emulator does with a tab, except that a death is never hidden:
- a shell that exits, e.g. by `exit` or Ctrl+D, whatever its status, closes;
- a command, given at creation, that ends stays, showing its last screen and tmux's line "Pane is dead (status 1, …)" (tmux before 3.3 draws that line by scrolling the screen up one line, so the top line, e.g. the only one of a typo's message, moves into the scrollback);
- a program ended by a signal, e.g. by the OOM killer, stays too, in a shell Terminal as in a command one.

The exit status of a shell says nothing: after Ctrl+D, it is that of the last command run.
So tmux keeps every pane that ends (`remain-on-exit`), and the hook `pane-died` closes that of a shell that exited.
A command Terminal is told apart by a pane option, `@hephaistos_command`, set by the command list that creates it, also for one that ends at once; panes made by hand, and those split off by hand, count as shells.
The hook marks the panes it keeps, `@hephaistos_ended`.
tmux runs it once it knows how the program ended, which it may learn only after the pane counts as dead (`pane_dead`, its pty closed), so only a marked pane counts as ended.
How it ended comes from `pane_dead_status`, or `pane_dead_signal` and `pane_dead_time` since tmux 3.3; before, a pane without a status was ended by a signal, which tmux does not name, at a time it does not say.

tmux before 3.6, built with utempter as Ubuntu's and Debian's are, sometimes never learns that the process of a pane ended ([tmux 4559](https://github.com/tmux/tmux/issues/4559)): utempter resets the handler of SIGCHLD while the pane closes.
About one exit in five left a pane dead and blank, its hook not run, until another child of the server ended.
So for those versions, our config starts one job in the server, guarded by `@hephaistos_reaping`, which sends it SIGCHLD twice a second, as tmux 3.6 does itself, and ends with it.

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
Its Terminal still runs, so where its ID reads, as it comes before any name or path, its row stays as it was, e.g. after a `cd` into a directory whose name holds the separator.
Without a server, or with one whose socket refuses connections, e.g. left by a crash, there are no sessions.

### Killing

Killing a Terminal ends its session, and its processes get SIGHUP.
What ignores SIGHUP outlives it.
`force` sends SIGKILL first, to the scope the process of the Terminal runs in, never that of the server, and to every process in the session of its pane.
Killing an ended Terminal closes its pane; `force` also ends what its command left running, where tmux still names its process, which it forgets since 3.8.

### Versions

Terminals need tmux 3.2a or later; an older one or none fails with a message naming `terminals.tmux.path`.
A version we cannot read, e.g. `master`, counts as new enough, and is logged.
`hephaistos status` and the Status View check tmux too, before any Terminal is made ([status](../daemon/status.md#checks)).
The tests run with every minor version since 3.2a ([development](../../development.md#tests)).

## Observing

Each Machine stores its Terminals in `state_terminals` ([data](data.md)), as the Keeper last showed them; the Watcher observes them in each pass.
The Keeper runs outside any transaction, then one write session compares its sessions with the rows.
A row observed after the Keeper was asked, e.g. of a Terminal another process created meanwhile, is a newer reading: it stays as it is, as those of Clones do ([observation](observation.md)).

A Terminal is **open** while its program runs, **ended** once its pane stays ended, and **lost** once it cannot run any more:
- its session gone, the server running in the same boot: it closed, e.g. its shell exited or someone killed it, and its row goes;
- the server gone in the same boot: it crashed or was killed, so its Terminals are lost;
- another boot (by the Linux boot ID): they are lost too.

An ended one keeps its exit status, or the signal that ended it, if tmux says which, and when it ended, or was first seen ended where tmux does not say.
Lost ones keep their row and name, to be restored with both, or killed.
So do ended ones whose session went with the server: they stay ended, with how, their last screen gone.
Both keep when their session was found gone, and why: `reboot` or `server`.
A session found again, e.g. one ended and respawned by hand, is open, without what it was.
Terminals record no Events ([ADR 001](../../decisions/001-data-ownership.md)).

A session without an ID, e.g. one started by hand on our socket, is adopted: it gets one and a row.
So does one whose ID is not valid, or is that of another session.
One named like a Terminal whose session is gone, lost or ended, takes the ID of that one, so that `tmux -L hephaistos new -s api` after a reboot brings `api` back.
tmux compares and sets the ID in one command, so two processes adopting at once agree on it.

Names are unique per Machine, ended and lost Terminals included.
A Terminal renamed by hand to the name of another takes it; the other moves to a free name, e.g. `api-1`.
Names hephaistos gives have ASCII letters, digits, `-` and `_`, at most 64, not starting with `-`; adopted ones keep their name in tmux, whatever it is.
The default name of a new Terminal is that of its directory, numbered from 1: `hephaistos-1`, `hephaistos-2`.

Without a working Keeper, e.g. without tmux, a Machine without Terminals is no news; with some, it is logged and a problem of the pass ([Watcher](../daemon/watcher.md#failures)), and their rows stay as they were, their age showing it.

## Actions

Creating, attaching, renaming and killing a Terminal (`core/terminals/actions.py`) serve the CLI and, later, the Server.
Each observes first, so that it acts on what the Keeper holds now, then acts on the Keeper, then observes again: State comes from the one comparison.
A Terminal whose session is gone, lost or ended, has none, so renaming or killing one changes its row alone; killing forgets it, also one whose session went while being killed, as its server ended meanwhile.
Killing an ended one with its session closes that, its last screen with it.

A new Terminal starts in an existing directory we can enter, stored with symlinks resolved, whose path is UTF-8, as text in the database is, and holds no separator of our listing (`\x1e`, `\x1f`), as its session would not read back.
Names and paths only observed, e.g. after a `cd`, are stored with U+FFFD (�) for bytes that are not UTF-8, so that they never stop an observation.
A name given that is taken, by an open, ended or lost Terminal or by a session not observed yet, is refused.
A default name that another process takes meanwhile moves on to the next free number.
A command that ends at once, e.g. a typo, is created ended, so that its message shows; a shell that ends at once, e.g. by its profile, is refused, and so is one lost at once as its server ended meanwhile.

Attaching gives the command that attaches a terminal emulator: for tmux, `tmux attach-session` with our socket and config, targeting the session by its ID.
Attaching to an ended Terminal is plain tmux too: its last screen shows, with tmux's line, typing there does nothing, and the prefix with `d` leaves.
One whose screen went too is refused, saying how it ended and why its screen went; nothing starts in it again, as its command may have been anything.
Attaching to a lost Terminal first starts it again, with its ID, name and directory, as the login shell.
A short `sh` prints a dim line first: "restored after a restart; earlier output is gone", with what a command Terminal ran, which does not run again, as it may have been anything, e.g. a deployment.
Where its directory is gone, it starts in the home directory, and the line says so.
Its row then holds no command, as it runs a shell.
Two attaching to the same lost Terminal at once both attach to it: the second finds it restored by the first.

Attaching is refused at a tty that the Terminal shows, where its output would loop back into it (`Keeper.shows`): one of its panes, or that of another Terminal attached in it, and so on, by the clients of tmux and their ttys.
Dead panes count for none: tmux keeps the name of the pty it closed, which another pane, of any program, may have now.
tmux refuses the same only with `TMUX` set, which no Terminal has.
A Terminal shown through a tmux of the user, e.g. one started inside it, is not found that way, as tmux itself does not find it across servers.
`terminal create` attaches to the new Terminal by its ID, without observing again, so it attaches also if renamed meanwhile, and to the last screen of a command already ended; a shell that exited already says so.


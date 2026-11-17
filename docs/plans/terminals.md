# Plan: Terminals

The step that brings Terminals: shells on a Machine that outlive what shows them, kept by tmux, listed in State, attached from the CLI, and later shown in a Terminal View.
Branch `terminals`, worktree `~/orca/workspaces/hephaistos/terminals`.
Decisions that landed are in the ADRs and design docs ([terminals](../design/core/terminals.md), [status](../design/daemon/status.md)); this plan holds what is still to do, and what was agreed for it.

## Goal

A Terminal View: a terminal in a Panel that feels like a plain terminal emulator, e.g. GNOME Terminal, with its own scrolling, selection, mouse, keys and colours, and no sign of tmux.
Closing the Panel, the GUI or the Daemon leaves the Terminal running.
The CLI attaches with plain tmux, which shows that it is tmux.

## Steps

- [x] 1a.1 The rules for names, shared between kinds of entities.
- [x] 1a.2 The Keeper: tmux on a socket of its own, each Terminal in a systemd scope of its own; CI with every tmux minor version since 3.2a.
- [x] 1a.3 `state_terminals`, the observer and the Watcher (schema 4).
- [x] 1a.4 `hephaistos terminal create|list|show|rename|kill`, and the API (0.22).
- [x] The Status View, from the branch `lczech/status-view` (API 0.23).
- [x] 1a.5 The tmux check, and what a pass could not observe (API 0.24, 0.25).
- [x] 1a.6 Robustness: a soak test, tests under load, fault tests, property tests with every tmux version, and the bugs they found.
- [x] 1a.7 Clean-ups before attaching:
  - [x] possessives rewritten in what this branch added ([style](../style.md));
  - [x] paths that are not UTF-8 refused at `clone register` and `terminal create`; a Worktree at such a path skipped, as a problem of the pass;
  - [x] the output of git read as bytes, so that a `\r` in a path stays one;
  - [x] `TMUX` and `TMUX_PANE` removed in each Terminal (`env -u`), so that a `tmux` typed inside reaches the tmux of the user, as from any terminal emulator;
  - [x] errors of tmux decided from state, never from its messages: whether the socket answers, whether a session is still listed, whether a name is taken; the rule goes into [development](../development.md#principles).
- [x] 1b Attaching from the CLI:
  - [x] our tmux server runs the defaults of tmux, plus only the settings it needs: `exit-empty off`, `history-limit` from `terminals.history`, `default-terminal xterm-256color` with true colour (as in GNOME Terminal; see [terminals](../design/core/terminals.md#socket-and-config) for what it means when attached from the CLI), `update-environment` extended, `extended-keys on`, `focus-events on`, `escape-time 10`; no status bar or key bindings of ours, and never the config of the user;
  - [x] `terminal attach` hands over to `tmux attach-session`, targeting the session by its ID: plain tmux, with its green bar and Ctrl+B;
  - [x] attaching to a lost Terminal restores it, with the same ID, name and directory, as a shell: a short `sh` prints a dim line ("hephaistos restored this terminal as a new shell, as the machine restarted (noticed …; last active …); earlier output is gone", and "it ran …, which does not start again" for a command Terminal), then becomes the login shell;
  - [x] `terminal create` attaches when run interactively; `--detached` stays out (no short form: `-d` is `--dir`);
  - [x] attaching is refused when not run interactively, and at a tty that the Terminal shows, e.g. inside it;
  - [x] tests: the CLI attach run inside a second tmux, its screen read with `capture-pane`.
- [x] Fixes from a review (branch `terminals-review`): names of Terminals renamed by hand in one pass, sessions listed but not readable, retries of Clones and Terminals apart, systemd failing in the checks, the Status View against an older Daemon, attaching where it cannot loop.
- [x] Paths in `hephaistos status` and the Status View: the code, config, data and log directories and the Desktop profile, with sizes; the same in `machine show` (API 0.26).
- [x] The GUI tests fuzzed (`scripts/test_gui_fuzzed.sh`, weekly in CI): answers in any order, refetches at random; the four bugs found fixed (History, Changes, Diff, Log), lists showing all of an answer while the next loads.
- [x] 1c Exit statuses, decided with the user (2026-11-13):
  - [x] a shell that exits closes, whatever its status, as a tab of a terminal emulator does; a command that ends stays, showing its last screen, and so does any program a signal ended, until killed;
  - [x] `remain-on-exit`, a `pane-died` hook closing the panes of shells, a pane option marking commands, and one marking the panes the hook kept, as a pane counts as dead before tmux knows how it ended;
  - [x] for tmux before 3.6, built with utempter as Ubuntu's is, a job in the server sends it SIGCHLD twice a second: it missed about one exit in five (tmux 4559), leaving a dead, blank pane;
  - [x] State: `ended`, with the exit status or signal and when; when and why a session went (`reboot`, `server`), ended ones staying ended with their screen gone; columns added to schema 4;
  - [x] `create` returns a Terminal as found right after, with no wait: a command ended already, e.g. a typo, as ended, whose message then shows; it says what it was given, not that it runs; attaching to an ended one is plain tmux on its last screen, refused once that is gone; the CLI and the API (0.27) say how and when each ended and why it went;
  - [x] found on the way: directories holding the separators of our listing refused; no tty of a dead pane counts when refusing an attach; an ended one keeps the program it last ran, never one of our wrappers;
  - [x] Ctrl+D closes an ended Terminal, as it closes a shell, by a key binding that passes it on to any pane not dead; since tmux 3.3, the line of a dead pane says so, and what ended, how and when ("Command exited with status 1 at …"); `terminal close` closes, as a tab closes (SIGHUP), `terminal kill` kills (SIGKILL), and either removes what is left of one whose session is gone.
- [ ] 2 The stream in the Server: one control-mode client per open Terminal View, over a WebSocket; the parser of control mode, which passes what it does not know and says so once.
  To find out with tests: whether tmux and xterm.js both answer the queries of a program, e.g. which terminal it is in.
- [ ] 3 The Terminal View (xterm.js): a Panel whose Terminal ended or was lost says so, with actions; see [ideas](../ideas/terminals.md#the-terminal-view).
  Ctrl+D closes an ended one, as attached from the CLI: control mode runs no key bindings, so the View does it.
  To test: keys (e.g. Home, End) and colours reach programs as xterm.js sends them; a pane whose size another client sets (`window-size latest`, e.g. the CLI attached too) still shows well in its Panel.
- [ ] Terminals on other Machines.

## At the merge

- The database of the user is at schema 3: `.agents/scratch/terminals/migrate_schema_4.py` (not tracked) carries it over, with the Daemon stopped, after a backup; it was tested on copies.
- The branch `terminals-before-rebase` is a backup of the state before the rebase onto master (2026-11-08); delete it once the rebase is accepted.
- This plan is deleted, once its decisions are in the ADRs and design docs.

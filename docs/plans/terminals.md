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
- [ ] 1a.7 Clean-ups before attaching:
  - [ ] possessives rewritten in what this branch added ([style](../style.md));
  - [ ] paths that are not UTF-8 refused at `clone register` and `terminal create`; a Worktree at such a path skipped, as a problem of the pass;
  - [ ] the output of git read as bytes, so that a `\r` in a path stays one;
  - [ ] `TMUX` and `TMUX_PANE` removed in each Terminal (`env -u`), so that a `tmux` typed inside reaches the tmux of the user, as from any terminal emulator;
  - [ ] errors of tmux decided from state, never from its messages: whether the socket answers, whether a session is still listed, whether a name is taken; the rule goes into [development](../development.md#principles).
- [ ] 1b Attaching from the CLI:
  - [ ] our tmux server runs the defaults of tmux, plus only the settings it needs: `exit-empty off`, `history-limit` from `terminals.history`, `default-terminal tmux-256color` with true colour, `update-environment` extended, `extended-keys on`, `focus-events on`, `escape-time 10`; no status bar or key bindings of ours, and never the config of the user;
  - [ ] `terminal attach` hands over to `tmux attach-session`, targeting the session by its ID: plain tmux, with its green bar and Ctrl+B;
  - [ ] attaching to a lost Terminal restores it, with the same ID, name and directory, as a shell: a short `sh` prints a dim line ("restored after a restart; earlier output is gone", and "it ran: …" for a command Terminal, which does not run again), then becomes the login shell;
  - [ ] `terminal create` attaches when run interactively; `--detached` stays out (no short form: `-d` is `--dir`);
  - [ ] attaching is refused when not run interactively, and from inside the same Terminal (`HEPHAISTOS_TERMINAL`);
  - [ ] tests: the CLI attach run inside a second tmux, its screen read with `capture-pane`.
- [ ] 1c Exit statuses: `remain-on-exit` for every Terminal; a command that ended, or a pane ended by a signal, stays as ended, with its status or signal, until killed.
- [ ] 2 The stream in the Server: one control-mode client per open Terminal View, over a WebSocket; the parser of control mode, which passes what it does not know and says so once.
  To find out with tests: whether tmux and xterm.js both answer the queries of a program, e.g. which terminal it is in.
- [ ] 3 The Terminal View (xterm.js): a Panel whose Terminal ended or was lost says so, with actions; see [ideas](../ideas/terminals.md#the-terminal-view).
- [ ] Terminals on other Machines.

## At the merge

- The database of the user is at schema 3: `.agents/scratch/terminals/migrate_schema_4.py` (not tracked) carries it over, with the Daemon stopped, after a backup; it was tested on copies.
- The branch `terminals-before-rebase` is a backup of the state before the rebase onto master (2026-11-08); delete it once the rebase is accepted.
- This plan is deleted, once its decisions are in the ADRs and design docs.

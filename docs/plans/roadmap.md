# Roadmap

The steps: what is done, what is in progress, and what comes next.
Each step is grilled with the user, planned, built with tests, and stops for review.
A step that splits gets numbers such as 12.1 and 12.2.
This file is edited on master only, also when a branch merges; a branch keeps the progress of its step in its own plan, `docs/plans/<step>.md`.
Ideas that no step has planned yet are in [ideas](../ideas/).

## Done

Steps 1 to 17, from the foundations to Find in the Diff; the GUI cleanup; lists and the GUI words; commit links; GUI instances for worktrees; the Status View (2026-11-07); the title bar of the Desktop, with the View menu and buttons for columns of Groups (2026-11-08); the style guide (2026-11-08).
Git history, the ADRs and the design docs hold the details.

## Now

- **Terminals**, in the worktree `~/orca/workspaces/hephaistos/terminals`, branch `terminals`.
  Plan: in `docs/plans/` on that branch, until it moves there `.agents/scratch/terminals/DESIGN.md`.
  Done: 1a.1 to 1a.6, the Terminal in the Core and CLI.
  Next: 1b (attach), 1c (exit statuses), then the stream in the Server (step 2), the Terminal View (step 3), and Terminals on other Machines.
- **The Explorer View**, in the worktree `~/orca/workspaces/hephaistos/file-exporer`, branch `lczech/file-explorer`.
  Plan: in `docs/plans/` on that branch, until it moves there `.agents/scratch/explorer/PLAN.md`.
  Done up to search by name, with tests and fixes; the user tries it before the merge, after which the View menu offers it (`offered: "menu"`).

## Owed

- `GitRevisionPicker` imports `views/history/rows`: untangle it on a branch of its own from master, after the Explorer merges (the user asked not to forget it).
- Paths that are not UTF-8 crash Clones and Worktrees (`clone register`: `UnicodeEncodeError`), and `git.run` reads in text mode, which turns `\r` in paths into `\n`; the tests for Terminals found both (2026-11-07).
- A sweep of ordinary possessives, which [style](../style.md) discourages (the user asked, 2026-11-08): about 1800 in 307 files, most in `src/hephaistos` and `gui/web/src`.
  First the text that users read and the docs (about 400), then comments and docstrings per area, after `terminals` merges; each part rewritten by hand and reviewed.
  Scanners: `.agents/scratch/style/`.

## Next

In the order of AGENTS.md, each numbered when planned:

1. The Watcher on change ([daemon](../ideas/daemon.md)).
2. Other Machines and Sync, with the Machines View ([machines](../ideas/machines.md)).
3. Agents and attention ([agents](../ideas/agents.md)).
4. The inbox ([inbox](../ideas/inbox.md)).
5. The phone ([gui](../ideas/gui.md#phone)).

Launchers come later, unnumbered: the more the GUI does, the less it matters to open things in other applications, so they are not proposed as next ([desktop](../ideas/desktop.md#launchers)).

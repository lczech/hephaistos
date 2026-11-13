# Roadmap

The steps: what is done, what is in progress, and what comes next.
Each step is grilled with the user, planned, built with tests, and stops for review.
A step that splits gets numbers such as 12.1 and 12.2.
This file is edited on master only, also when a branch merges; a branch keeps the progress of its step in its own plan, `docs/plans/<step>.md`.
Ideas that no step has planned yet are in [ideas](../ideas/).

## Done

Steps 1 to 17, from the foundations to Find in the Diff; the GUI cleanup; lists and the GUI words; commit links; GUI instances for worktrees; the Status View (2026-11-07); the title bar of the Desktop, with the View menu and buttons for columns of Groups (2026-11-08); the style guide (2026-11-08); the Explorer View (2026-11-11); lists virtual, reached by the keys, with ARIA (2026-11-13).
Git history, the ADRs and the design docs hold the details.

## Now

- **Terminals**, in the worktree `~/orca/workspaces/hephaistos/terminals`, branch `terminals`.
  Plan: in `docs/plans/` on that branch, until it moves there `.agents/scratch/terminals/DESIGN.md`.
  Done: 1a.1 to 1a.6, the Terminal in the Core and CLI.
  Next: 1b (attach), 1c (exit statuses), then the stream in the Server (step 2), the Terminal View (step 3), and Terminals on other Machines.
- **A review**, in the worktree `~/orca/workspaces/hephaistos/test-review`, branch `lczech/test-review`: a reminder of something the user wants to review there; no work yet, and rebased onto master before it starts.

## Owed

- Flaky browser tests, seen only with all three browsers running (2026-11-09): `DiffView.browser.test.tsx` "brings a match it steps to into view, in a file not drawn yet" fails in Firefox in about half of the full runs of `npm run check`, and never recovers within 30 s; it passes alone, under CPU load, and with Firefox alone.
  `ExplorerView.browser.test.tsx` "starts a row's icon where its parent's name does" failed once in WebKit inside `userEvent.click` (`e.includes` of undefined); it passed alone three times, and timed out once in Firefox in a full run (2026-11-12).
  `DiffView.browser.test.tsx` "marks the matches drawn, the current one apart" timed out in two full runs, in Chromium and Firefox (2026-11-12); it passes alone, and passed in the next two full runs.
- A match the Explorer's find found in a folder holding more entries than `files.max_entries` vanishes once that folder's listing comes, which stops at the limit, and stepping through the matches skips it (found by a review, 2026-11-11).
- For the steps of xterm.js and Monaco: check their own controls against the rule that every button, field and text area takes the page's font (`theme.css`), which reaches theirs too.
- `GitRevisionPicker` imports `views/history/rows`: untangle it on a branch of its own from master, after the Explorer merges (the user asked not to forget it).
- Paths that are not UTF-8 crash Clones and Worktrees (`clone register`: `UnicodeEncodeError`), and `git.run` reads in text mode, which turns `\r` in paths into `\n`; the tests for Terminals found both (2026-11-07).
- A sweep of ordinary possessives, which [style](../style.md) discourages (the user asked, 2026-11-08): about 1800 in 307 files, most in `src/hephaistos` and `gui/web/src`.
  First the text that users read and the docs (about 400), then comments and docstrings per area, after `terminals` merges; each part rewritten by hand and reviewed.
  Scanners: `.agents/scratch/style/`.
- The List, once `lczech/git-graph` merges, on a branch of its own from master (the user agreed, 2026-11-13): split `List.tsx` and `VirtualRows.tsx` into the keys and focus, the rows stuck and the rows kept in place; and the square columns named by their Views (`description`), not by `HEADERLESS` in `ColumnHeader.tsx`.
- A line at the top edge of a list, above its header, at a device scale of 1.25 in Chromium and WebKit, outside the list's box; the header sticking a pixel further did not help (2026-11-12).
- The Database View has no browser test; it has no styles of its own on its rows.
- A List within another's details: the outer one's keys skip its rows, but its leaving Tab to the row focused alone (`untab`) would reach the inner one's buttons too; no View nests Lists yet.

## Next

In the order of AGENTS.md, each numbered when planned:

1. The Watcher on change ([daemon](../ideas/daemon.md)).
2. Other Machines and Sync, with the Machines View ([machines](../ideas/machines.md)).
3. Agents and attention ([agents](../ideas/agents.md)).
4. The inbox ([inbox](../ideas/inbox.md)).
5. The phone ([gui](../ideas/gui.md#phone)).

Launchers come later, unnumbered: the more the GUI does, the less it matters to open things in other applications, so they are not proposed as next ([desktop](../ideas/desktop.md#launchers)).

# Ideas: Views

Ideas for single Views; those for the GUI as a whole are in [the GUI](gui.md).

## History

User, 2026-10-17: for a merge, its changes against another parent; a filter by author; the successor of a rebased commit; maybe `--all`, with a graph of lanes.

## Changes and Diff

- One instead of two (user, 2026-10-23: later; new features first): they always come as a pair (`ChangesLinks`).
  Either one View with two looks, a list or diffs, in the fragment, where a click on a file switches to it in the diffs (the stacked Diff, folded, is already an index); or the pair opened together, Changes here and its Diff beside, where clicks on files scroll that Diff.
  A sidebar inside a Panel was dismissed as too crowded.
- From Changes to a stacked Diff (agreed 2026-10-20): while a stacked Diff of the same comparison shows, a click on a file in Changes scrolls it there rather than opening the Diff of that file.
- Bare Clones in Changes: no working tree or index, so the pickers could compare commits, branches and tags as forges do, without the rows Working tree and Staged.
- Paging past `gui.diff.max_files` (user: "when bored"): `skip` in the Core, an API parameter, "N more" as a button, and live hints that fetch all pages again; one or two hours.
- Speed: folding big stacks still spends about 340 ms in layout reads by the virtualizer of Pierre.
- The bundle: lazy loading of the popover in `GitRevisionPicker` (+47 kB gzipped); the user has not decided.

## Find

- Colouring the regular expression in the field.
- Replace, with `$1` (no changing files until proven safe).
- Counting page by page, if big stacks feel slow; measure first.
- In Monaco and Terminals (discussed 2026-10-23, to decide with them): our `FindBar` and address part, their matching and marking.
  `@xterm/addon-search` for xterm is headless (colours passed in, it reports X of Y); in Monaco, its widget hidden, and `model.findMatches` with decorations that carry our classes.
  Check whether our rewriting of `\w` to any script survives their handling of regular expressions.
  Monaco has a cursor, so find there starts from it, as in VS Code (user, 2026-10-23); Diffs have none, so they start at match 1.

## Explorer

- File kinds as a plugin (user, 2026-11-06: "super not urgent"): mappings from file names and extensions to the icons of the Explorer, e.g. for bioinformatics formats (`.fasta`, `.nwk`) that the general table leaves out.
  The folder icons stay ours (decided 2026-11-09).
- The File View, showing a file of the Explorer; then the Explorer at a Revision (below) and "Find in folder".
- Writing to files (renaming, deleting, dragging) waits for the rule of [ADR 003](../decisions/003-core.md) for the files of the user.
- The find row at sidebar widths waits for a sidebar (decided 2026-11-09); a sidebar with Workspaces.
- The Explorer at a Revision (user, 2026-11-06; after the File View): with a Checkout and a Revision, it lists `git ls-tree`, read-only, marking what that commit changed against its parent, as the commit page on GitHub does.
  The address or kind of the View decides whether the Revision picker shows, not a toggle: the Explorer in a sidebar, on disk, never shows it; the repository at a commit, linked from the rows of History, does.
  Its search then lists paths by `git ls-tree -r --name-only <rev>` through the same `/api/files/paths`, with a `ref` parameter, matched in the browser as on disk; "ignored" does not apply.
- A field with the last commit of each entry (hash, subject, time), as the file tree on GitHub shows it, on disk too: one `git log` walk per Directory until all names are found, not one per file; optional, as it costs.
- "Find in folder" on a row, as "Find in Folder…" in VS Code.
- Several tops in one Explorer, each a row that folds, as the workspaces of VS Code with several folders show them (user, 2026-11-09): with Workspaces, e.g. the Checkouts of a Workspace.
- "Terminal here": see [Terminals](terminals.md#elsewhere); opening in other applications: see [Desktop](desktop.md#launchers).

## Status

Stats (user, 2026-11-07: "maybe not now"): counts and sizes (Repositories, Clones, Worktrees, Terminals, commits; the sizes of the database and the logs) as a section of the Status View or a View of their own, kept out of its About section.

## A View for cleaning up branches

"Upstream gone" (an upstream set, ahead and behind NULL) can be derived from stored columns.
Dropped on 2026-10-07 as marginal, not to be proposed again unless asked: an operation in progress, the time of the last fetch, the number of stashes.

# The Explorer

The step: the Explorer View, a Directory on the Machine as a tree with columns, read-only, as VS Code shows files ([views](../design/gui/views.md#explorer)).
Branch `lczech/file-explorer`, worktree `~/orca/workspaces/hephaistos/file-exporer`.
Git history holds how it was built; the design docs hold how it works.

## Done

- The plan of eight commits: the list component renamed, the parts that Changes and the Diff share, a generic tree and a layer for files, the listing in the Core, CLI and API, the View, git colours and columns, row actions.
- Then: folders that stay in view while their rows scroll past, columns aligned left, centre or right, sizes by amount and unit, search by name (Core, CLI, API and GUI).
- Tests and fixes, each in the commit it covers: browser tests of how the tree lays out, a check that each View stops drawing once its data came, and more cases for the listing and the search.
- Rebased onto master (2026-11-08), in the style of [style](../style.md); the View menu offers the Explorer (`offered: "menu"`), and the rows of Repositories link to it, at a Checkout.

## Now

Done (2026-11-09): going into a folder from its menu, `root` in the address, the links of the Checkout in the bar, and the path bar shown once the home directory is known.
Also done: controls take the font of the page in all browsers; the buttons of all bars come in three groups, a line between them ([views](../design/gui/views.md#view-bars)).

## Before the merge

- The user tries it in the worktree: `scripts/worktree_gui.sh start`.
- Checked (2026-11-09): on a slow connection, names, git letters and fields arrive together, as both requests of a folder run at once; only a slow `git status` would colour names later, and nothing moves then.
- Decided: the find row at sidebar widths waits for the sidebar; the folder icons stay ours.
- At the merge: the decisions go into the ADRs and design docs, the roadmap on master records the step, and this file is deleted.
  For the "Owed" list of the roadmap: the browser test `DiffView.browser.test.tsx` "brings a match it steps to into view, in a file not drawn yet" fails in Firefox in about half of the full runs of `npm run check`, and never recovers within 30 s; it passes alone, under CPU load, and with Firefox alone.
  Also there: `ExplorerView.browser.test.tsx` "starts a row's icon where its parent's name does" failed once in WebKit inside `userEvent.click` (`e.includes` of undefined), only with all three browsers running at once; it passed alone three times.
  For the steps of xterm.js and Monaco: check their own controls against the rule that every button, field and text area takes the page's font (`theme.css`), which reaches theirs too.

## After the merge, each a step of its own

- Keyboard and ARIA for all lists: a treegrid, whose rows may stay flat, with `aria-level` and `aria-expanded`.
- Density for all lists.
- Dragging rows into Groups.
- The File View; then the Explorer at a Revision and "Find in folder" ([ideas](../ideas/views.md#explorer)); a sidebar with Workspaces.

Writing to files (renaming, deleting, dragging) waits for the rule of [ADR 003](../decisions/003-core.md) for the files of the user; file kinds as a plugin are in the [ideas](../ideas/views.md#explorer).

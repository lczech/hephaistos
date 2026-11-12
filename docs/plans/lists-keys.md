# Lists virtual, reached by the keys

The step: every list of the GUI draws only the rows near the view, keeps its rows stuck as now, and is reached by the keys, with ARIA.
Branch `lczech/lists-keys`, worktree `~/orca/workspaces/hephaistos/lists-keys`; virtualization first, then the keys and ARIA, merged together, as Tab reaches only the rows drawn.
Decided with the user on 2026-11-11, after a prototype, and on 2026-11-12, by a grilling.
Git history holds how it was built; the design docs hold how it works.

## Where it starts

On master, every list draws all its rows, and a tree draws the rows of a folder within the row of that folder, so that CSS keeps the folder in view while they scroll past.
The prototype, branch `proto/explorer-virtual` (no worktree; kept until this step merges), made the Explorer alone virtual, as a throwaway: its own commits are `git log e16235e..proto/explorer-virtual`, to be diffed with `git diff e16235e proto/explorer-virtual`.
Its stuck folders slide out, pushed up by the next, which the user chose over the others it offered (its corner button and `proto.stuck` in localStorage are for comparing only).

Why (measured 2026-11-11 by scripts in `.agents/scratch/explorer-perf/` and `explorer-virtual/` of the main checkout): in an Explorer of 1,900 rows, all drawn, opening a folder shows its rows after about 860 ms, and dragging the edge of a column blocks the page for about 4.4 s in all; virtual, about 160 ms, no task over 50 ms, and scrolling smoothly.
Skipping the rows that did not change was ruled out: TanStack Table makes every row anew when the data changes, in a tree whenever a folder opens, so it would need comparing rows by hand, which lint rejects ([development](../development.md)), or drawing cells around TanStack.

## Goals

### 1. All lists virtual

In the List, for all lists, as flat rows: only those near the view drawn, by TanStack Virtual (`useVirtualizer`), as documented.
- Rows measured exactly, not rounded to pixels: `measureElement: (el, entry) => entry?.borderBoxSize[0]?.blockSize ?? el.getBoundingClientRect().height`; the default rounds, and spaced rows 18.84 px high 19 px apart.
- Rows placed by `top` (`directDomUpdates: true, directDomUpdatesMode: "position"`): text at a fraction of a pixel moved by `transform` is drawn blurred.
- The component in a file of its own, which React's compiler leaves out (`sources` in `vite.config.ts`): the compiler refuses `useVirtualizer` ("incompatible library"), whose virtualizer stays the same object as what it shows changes, and our compiler logger turns that skip into a build failure.
- A row and its details are one item, measured.

Needed as rows not drawn are not on the page:
- `seen` is said for the rows drawn only, each once as it is drawn, not by watching every row anew on each draw; the menu of a row is built only when asked for, not for every row to know whether it has one (both found by a review, 2026-11-11).
- Scrolling to a row by its ID, drawn first if it is not (`current`): the find of the Explorer, which now looks for the row on the page, and the find of the Diff, stepping into an untracked file whose row is not drawn.
- The Diff's List, part of a page, is virtual within the scrolling of that page.
- What a row was told to show is kept outside it, by its ID, as rows drawn again forget their own: the large diffs shown in the Diff's List, beside its open rows.
- Rows in view stay where they are as rows come or go above them (live updates), as the scroll anchoring of browsers keeps them now, which does not reach rows placed by the virtualizer: the first row in view, found again by its ID, is put back where it was; at the very top, new rows show, as now.
- A list in a Panel hidden measures nothing: shown again, its rows and its scroll position are as they were.
- Tests in jsdom, which measures nothing, would see almost no rows: the setup gives lists a view tall enough.

### 2. Rows stuck as now

One rule for what sticks: a row whose content is open (a folder's rows, a file's diff, an event's details) stays below the header, and below the rows holding it, while that content scrolls past, sliding out, pushed up by the next.
In the Explorer, and in the trees of Changes and the Diff's List, below what stays at the top of their page; flat paths hold no folders, so nothing sticks there.
A click on a row stuck scrolls it to its place, at the top, then closes it.

Needed as rows are flat and those far above are not on the page: the rows stuck are copies, drawn apart, above the rows, hidden from screen readers and not focusable.

Built from the prototype, kept close to its `FlatRows.tsx` and its CSS, as getting them right took long:
- `shape` (the parent of each row, and the last row it holds), `stuckRows` over the measurements of the virtualizer, `rowAt` (a binary search of them); sliding, `top = min(slot, end of what it holds - its height)`.
- The `onChange` of the virtualizer fires only when the range drawn changes, so a scroll listener updates the copies (`flushSync`); the height of the header is measured in a layout effect after each draw; the copies need `top: auto`, and deeper ones lie lower (`z-index`), so that one leaving slides below those holding it.
- Dropped: its other ways of sticking, the button in its corner and `proto.stuck`.
- Added, as it had none of them: rows whose details are open, whose own height is not that of their item; a list part of a page; a click on a copy; lists that are not trees.

Without seams, in all browsers: rows lie at fractions of a pixel and are drawn at whole pixels each on its own, so a pixel of the rows passing below may show between two (found 2026-11-11, scripts in `.agents/scratch/sticky-folders/`).
On master, a row covers that pixel once stuck, which only Chromium can tell (`scroll-state`, commit `342aad8`).
Drawn apart, the copies lie on one block of the background, from the header to the end of the lowest, which also covers the pixel just above the header seen at a device scale of 1.25.

### 3. The keys and ARIA

A treegrid: rows with `aria-level` and `aria-expanded`, `aria-rowindex` of `aria-rowcount`, `aria-posinset` of `aria-setsize`; the header a row of column headers.
The keys act on rows, not on a chevron, so a list without one works the same; rows that open nothing are reached too, which they are not now.
- Up and down between rows, also PageUp and PageDown, Home and End; up from the first row stays there.
- Left and right fold and unfold; left on a row within one goes to it.
- Enter and Space open a row as a click does.
- The menu key and Shift+F10 open the menu of the row, or of the header.
- The rows are one Tab stop (a roving `tabindex`): Tab from the row focused goes through its own links and actions, then its open details, then out of the list; Shift+Tab back.
  Those of other rows, and the button of the row that opens or folds it, are out of the order of Tab, the button still clicked.
  Escape there returns to the row, closing its details.
- Tab into the list goes to the row focused last, else to the first row in view, so that entering it never scrolls it; the header stays reached by Shift+Tab.
- The row focused is the only selection; a click makes the row clicked the one focused, so that the keys go on from it.
  It stays drawn while scrolled away, and stays focused when rows change (live updates).
  Gone: within a folder closed, the folder takes the focus; else the row now at its place, or the one before where it was the last; with no rows, none.
- Seen as now: nothing until a key is pressed, then the frame of the accent colour around the row (`:focus-visible`); nothing while the list has no focus.

## Commits

0. Tests of what lists do now, as seen, not as built, passing before and after: rows stuck sliding out, without seams (in Chromium until commit 2), nested; rows evenly apart at fractional heights; rows in view kept in place by live updates; a list in a Panel hidden and shown again.
1. TanStack Virtual, in a file the compiler leaves out; all lists as flat rows, only those near the view drawn; `seen` and menus as above; the setup of jsdom.
2. The rows stuck, as copies; a click on one.
3. The Diff's List virtual within its page, and stuck below what stays at its top; Changes the same; the large diffs shown kept outside the rows.
4. Scrolling to a row by its ID: the finds of the Explorer and the Diff.
5. ARIA.
6. The keys; the design docs (`lists.md`, `interaction.md#keys`).

Each commit with its tests: unit tests for what is pure (`stuckRows`, the shape of a tree, moving the focus), browser tests for what is measured and drawn.
A double click on the edge of a column then fits it to the rows drawn only: said in `lists.md`.
No screenshots kept as references, which every font, theme and browser would make anew: the scripts of the prototype (`look`, `nested`, `pitch`, `measure`), copied to `.agents/scratch/lists-keys/`, compare master and this branch once, in screenshots and times.
All commits at once, then one `/code-review` and the measuring; the user tries it all once, and fixes go into the commits they belong to.

## Done

All commits, then one `/code-review` (high), whose ten findings are fixed in the commits they belong to (2026-11-12).
Measured by `.agents/scratch/lists-keys/` against a scratch Daemon, master then this branch, the same steps (`results.jsonl` there):
- An Explorer of 1,900 rows: opening a folder shows its rows after about 150 ms, not 850 ms; dragging the edge of a column runs no task over 50 ms, not 4.4 s of them; scrolling 80 steps drops no frame (the worst 17 ms), not 3 (the worst 183 ms); closing a folder runs no long task, not 0.4 s.
- Scrolling does more on the main thread (about 1 s over 80 steps, not 0.3 s), within each frame.
- No line between rows stuck in Chromium, Firefox or WebKit at device scales 1 and 1.25 (`look.mjs`, `seams.py`).
  The line at the top edge of a list, above its header, at 1.25 in Chromium and WebKit, stays as on master: it lies outside the box of the list.

## Decided alone, for review

Choices the plan left open, made while the user was away, reversible.
- The component is `VirtualRows`; 12 rows drawn beyond the view each way; a row not measured yet guessed as high as the last one measured, at first 22 px.
- Until measured, a list is taken as high as the window, so that its first draw shows rows rather than none.
- Rows in view are kept in place by the List itself, by the key of the first, and only when the list was not scrolled since; at the top, new rows show.
- A row sticks only once scrolled past the header, so that no copy lies over a row in its place; rows with details stick in every list, as the plan says, Events, History, Repositories and the database too.
- A click on a copy scrolls, closes, and focuses the row itself; the copy takes no focus; its menu opens on the copy.
- The copies of the Diff's List are moved as the page scrolls, not stuck by CSS, as the list scrolls sideways itself.
- Tried and dropped: the header sticking a pixel past the edge, against the line above it at 1.25.
- ARIA: the list item is the row, and its details a cell of it, so that Tab reaches them from the row; in two lines, one column header holds the buttons; the button that opens a row keeps `aria-expanded` too; columns say how they sort (`aria-sort`).
- Biome's rules for tables are set aside where the roles are given (`Row`, `Cell`, `HeaderCell`), saying why.
- Keys: → on an open folder goes to its first row, as in VS Code; → and ← also open and close details; Escape on a row closes its details; keys with Ctrl or Meta are left alone; a page is the rows in view below those stuck.
- `opens` gets a click or a key alike (`Opening`: the button and Alt), so that Enter opens a View as a click does.
- `seen` is told for the rows drawn whenever they or what the View asks change (a finding of the review); a test of the Explorer's find now waits for the search typed to settle before a click, a race this showed.
- The tests of the Explorer's find no longer check `scrollIntoView` in jsdom; a browser test checks the match coming into view instead.
- Each list is named by its View (`label`, required): `Files`, `Events`, `Untracked files`; the Database View's two `Tables` and `Rows`.
- As axe found, rows and their group are `div`s with roles, as `li` and `ol` may not take them; a row's details are a region in a cell of it; the square's column is named `Open` for screen readers alone.
- The ring shows also in Firefox once the keys are in use, which it would not on a row focused by script after a click (`data-keys`).
- A key that does nothing on a row is left to the page; Alt with the arrows to the Group.
- The Diff's find brings the file of each match into view only where it is not drawn, so that stepping within a long diff never jumps to its top.
- More tests, as a second review proposed: 23 cases, of which 8 failed before their fixes (2026-11-12).
  `DiffView.browser.test.tsx` "marks the matches drawn, the current one apart" timed out in two full runs, in Chromium and Firefox; it passes alone and with the three browsers at once, and touches no list.

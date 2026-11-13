# The git graph

The step: a graph of lanes beside the commits, in History and in a new Graph View of a whole Clone, to see where each branch and Worktree stands against the others and the default branch.
Branch `lczech/git-graph`, worktree `~/orca/workspaces/hephaistos/git-graph`.
Decided with the user on 2026-11-11, after a prototype and research in `.agents/scratch/git-graph/` (untracked): its `README.md`, the pages in `out/`, and `research/terminology.md`, `features.md` and `nodes.md` on other git tools.

## Two Views, one list

- History stays the history of a Checkout from one Revision, with `path` and `search`, and gains the graph as a column, shown by default and hidden from the header menu, and the order.
  From one Revision the graph is not a straight line where branches were merged: it shows them beside it, as `git log --graph` does.
- The Graph View (`graph?clone=…`) shows a whole Clone: all local branches and the HEAD of every Worktree, detached ones too, as `--branches` misses those.
  It opens only from other Views, as History does: from the row of a Clone in Repositories, from the row of a Worktree (scrolled to its HEAD, its chip marked), and from the bar of History.
  Its icon is Lucide `git-graph`, in the git family.
- Both show one list of commits, in `views/commits/`, as `views/comparison/` holds what Changes and the Diff share: the list with its pages and uncommitted rows, its columns, `CommitBox`, the lane layout and the cell of the graph.
  `views/history/` and `views/graph/` keep their bars and parameters.
- The Core has one walk in `history.py`: from one Revision or a set of branches, in an order.
  `/api/history` gains `order` (both Views) and `branches` (the Graph View).
  `/api/graph?clone=…` gives what only the Graph View needs: the Worktrees with their HEADs and changes, the default branch, and ahead and behind for each branch.

## The graph

- Lanes are laid out in the GUI, row by row, newest first; a row depends only on the rows above it, so each page loaded on scrolling continues the layout, and rows drawn never change.
  Lanes waiting for the same parent stay apart until it comes, so a branch joins another where it left it; lanes keep their column, so lines are straight.
  Lanes passing a row are worked out only for rows drawn: a lane is kept as the rows it spans, not copied into every row (measured on the repository of git, 86,000 commits: 111 ms for all rows without them, 1.2 s with them).
- The lanes run through the whole height of a row: in two lines, and under a commit box opened below it; the node is level with the first line.
- The column fits the lanes of the rows loaded, up to about 8, until resized by its header; then it keeps its width, and clips lanes beyond it.
- The default branch is found by one rule, for every count and mark: `origin/HEAD`, else `init.defaultBranch` where that branch exists, else `main`, else `master`.
  In the Graph View it keeps lane 0, pinned to the left; in History, lane 0 holds the line of the start.
- Colours:
  - the default branch takes the accent, and lane 0 in History may too;
  - a lane led by a branch takes a hue from the name of the branch, the same across reloads, at a lightness and chroma set per theme;
  - lanes no branch leads take muted colours, by lane;
  - the badge of a branch takes the colour of its line; remote branches and tags keep the orange frame;
  - a small helper gives a hue for a name (`gui/web/src/hues.ts`), with lightness and chroma as tokens per theme, for Worktrees elsewhere later; lighter or darker variants are CSS relative colours where needed, and the fills by `color-mix` stay.
  - `looks.md` says "Nothing else is orange": reworded, as lanes may be orange or yellow.
- Nodes, as most tools draw them: a commit is a filled dot in the colour of its lane; a merge a ring with a dot inside, at the size of a commit; a HEAD a larger, thick ring; uncommitted changes a dotted ring, joined to its HEAD by a dotted line; a gap in the background colour around each node.
- Toggles:
  - the order, two modes: topological order (a drawn icon, a graph with the arrow of `clock-arrow-down`) and date order (Lucide `clock-arrow-down`); History by default in date order, the Graph View in topological order; kept as a parameter of each View.
- Badges: at most two on a row, the rest counted, all in the commit box; in the Graph View first the default branch, then branches checked out in a Worktree, other local branches, remote branches, tags.

## Worktrees and branches, in the Graph View

- The HEAD of each Worktree is the larger ring; the badge of its branch carries the icon and the name of the Worktree.
- A Worktree with changes has a row of uncommitted changes above its HEAD, with links to its Changes and Diff.
- A row of chips below the bar, one per Worktree, in the colour of its branch, with ahead and behind (`↑3 ↓12`, a part of zero left out, the tooltip saying "3 ahead of main, 12 behind"); a click scrolls to its HEAD.
- Ahead and behind are against the default branch; for the default branch, against its upstream (`origin/…`, as last fetched).
  All counts in one call where git has it (`for-each-ref --format=%(ahead-behind:…)`, git 2.41), else a call per branch.
- Where the Worktrees are: their HEADs from git when walking (`git worktree list --porcelain`, one call); their uncommitted changes from State, as Repositories and History take them.
- A click on a chip whose HEAD is not loaded yet loads pages until it is, saying so ("Loading towards terminals: 1,200 commits so far"), with a button to stop, and Escape, as Find closes; no limit, as pages are quick with the commit-graph file.
- A detached HEAD in the words of git: on its row, the HEAD badge with the icon and name of its Worktree; on its chip, "terminals (detached at abc1234)", with ahead and behind against the default branch.
- The branch filter, a button in the bar opening a menu, as the menu of columns in the header:
  - all local branches (default), less those hidden, kept in the address (`hide=…`), so a new branch shows;
  - or Worktrees only (`branches=worktrees`): the branches checked out in Worktrees, their detached HEADs and the default branch, the answer in the fewest rows to where the Worktrees stand;
  - below, each branch with a checkbox and "only this"; "show all" clears what is hidden.
  A hidden branch still shows its commits where a shown one leads to them.
  The chip of a Worktree whose branch is hidden stays, greyed, and a click shows it again.
- The tab is titled "Graph: hephaistos", and "Graph: hephaistos, 2 hidden" while branches are hidden; Repositories links to it from the rows of Clones and Worktrees, by Lucide `git-graph`, a Worktree scrolled to its HEAD.
- The Graph View has a refresh button, as History, and is asked again on the hints History is, and when the GUI regains focus.
  A branch moved without a checkout (`git branch -f`, `update-ref`, a fetch into a local branch) shows only then: carrying such moves from the Watcher to the GUI, by State or a hint of its own, was judged not worth its machinery (2026-11-12).

## The commit-graph file

Topological and date order make git walk all commits before the first: on the repository of git, about 0.8 s per page; with the commit-graph file of git, 11 to 160 ms.
- The Daemon writes it where it is missing, the first time a Clone is walked in either order: `git commit-graph write --reachable --split`.
  At most once a day, if the branches moved, it adds the new commits as a layer (`--split`).
- It writes in the background, apart from the passes of the Watcher, so that cutting a pass short still loses nothing; meanwhile, and wherever writing fails (a read-only filesystem, another owner, a lock held by git), the walk goes on without it.
- A setting turns it off (`git.write_commit_graph`, on by default).
- ADR 004 and the design docs of the Daemon (`server.md`: "git runs read-only"; `daemon.md`: "git only reads") are loosened: the Daemon may run git commands that write to repositories.

## Words

Defined under the Graph View in `docs/design/gui/views.md`, as the words of other tools and of git name them: lane, default branch (pinned to the left), all local branches, ahead and behind, merge base, uncommitted changes, topological order and date order, branch filter (hide, solo, show all).
Badges keep their name; git calls them decorations, and "reference labels" is the word of one tool.
The glossary names no View, so it gains nothing.

## Steps

Each step its own commits, stopping for review.

1. History, with the graph:
   1. the list of History moved into `views/commits/`, unchanged in behaviour;
   2. the lane layout, the helper for hues and the column of the graph;
   3. the order: in the walk of the Core, `/api/history`, and the toggle;
   4. the commit-graph file, with ADR 004 and the design docs.
2. The Graph View:
   1. the walk from branches (all local, or those of Worktrees, less those hidden) in the Core and `/api/history`, and `/api/graph`: the Worktrees, the default branch, ahead and behind;
   2. the Graph View: its list with the default branch pinned, its order and refresh, its title, the links from Repositories and History;
   3. Worktrees: rings, badges, uncommitted rows, chips, and loading towards a HEAD;
   4. the branch filter.

Branch tips only and compact lanes, planned as step 3, are ideas for later (user, 2026-11-13): [ideas](../ideas/views.md#history).

## Done

- `GitRevisionPicker` no longer imports from History: `headText` is in `revisions.ts`, `searchWords` in `text.ts`; at the merge, the roadmap on master drops the item it owed.
- 1.1: the list of commits, its columns, rows and styles, `CommitBox` and `CommitHeader` in `views/commits/`; History keeps its bar and its words (`views/history/text.ts`).
- 1.2: the lanes (`lanes.ts`), the hues (`hues.ts`), and the graph column of History, with lanes beside opened details and badges in the colour of their line; a column that stays in its place (`stays`).
  Found on the way: the details of a row have smaller text, so lengths in `lh` there are shorter: the end of the graph is a registered length (`@property --graph-end`).
  WebKit lays out nothing positioned in a flex row with `content-visibility: auto`: rows of a graph in two lines were always drawn, until the virtual lists of `lists-keys` replaced it.
  A branch merged and still named starts no lane of its own colour: its lane was opened by the merge, unnamed, and keeps its muted colour, so that rows drawn never change.
- 1.3: the order, by date or topological, in the walk of the Core, `/api/history` (API 0.26) and a toggle in History (`OrderToggle`, shared), its icon drawn.
  Decided (2026-11-12): History asks by date even with the graph hidden, rather than in the order of git; a first walk waits for git once, until the commit-graph file is written, and the order never changes under the user.
- 1.4: the commit-graph file (`core/utils/commit_graph.py`), written in the background by a walk in an order, the setting `git.write_commit_graph`, ADR 004 and the design docs of the Daemon.
  Simpler than planned: no check whether the branches moved, as `--split` adds nothing where nothing is new, and each Clone is tried at most once a day.

- 2.1: the walk from branches (`branches`, `hide`) in the Core and `/api/history`, and `/api/graph` (API 0.27), from `core/utils/graph.py`: the HEADs of the Checkouts, the default branch, ahead and behind.
- 2.2: the Graph View (`views/graph/`), its default branch pinned, its HEADs drawn as such, its order, refresh and title; links from Repositories and History; `Drawing` for how a list draws its graph.
- 2.3: the Checkouts in the Graph View: where they are on badges, HEAD badges when detached, uncommitted rows, chips with ahead and behind, going to a HEAD with Stop and Escape; `/api/graph` counts detached HEADs too (API 0.28).
- 2.4: the branch filter (`BranchFilter`): all local branches or Worktrees only, each branch ticked or not, "only", "Show all"; the checkboxes and "only" of the list filters, as ticked means shown here.
- After review (2026-11-12): the badge of a detached HEAD says `detached`; a hidden branch loses its badges, and the default branch its lane and accent, while hidden, as the filter says; the icon of the Graph View drawn (`GitTipsJoining`), as `git-graph` reads as a fork; going to a HEAD scrolls it to the top, and says so on its chip after 300 ms, not in a note that moved the list; Checkouts named by their folders, not by the names git gives Worktrees, which tools make IDs of.
- After the second review (2026-11-12): chips neutral, marked in the colour of the line of their HEAD, from the lines of the walk laid out ahead (`/api/graph/lines`, API 0.29); "Go to…" a branch, tag or commit (`GoToRevision`, split from `GitRevisionPicker`); a jump focuses and flashes its row (`ListHandle.goTo`, `flash`), and keeps the address, `at` being only where the Graph was opened; the tips of the lines above stay below the header in a row of their own (`band`, `tipsAt`), as the lanes keep where each line starts.
- After the third review (2026-11-13): the band hid not with its tab, as it set its visibility; tips slide into it and are pushed out of it with the rows; badges in one line; lanes without seams between rows. A review for what changes under the Graph found: a jump decided on the rows of the previous walk, the next page cancelling all pages loading anew (and from where they were before), a jump retried by the index of its row, and the focus taken long after a click; each fixed and tested, with tests of rebases, commits, Worktrees removed and HEADs rewritten away.

## Open

- Live hints, checked (2026-11-12): commits, rebases and resets in any Worktree reach the Views, by the reflog of its HEAD; a branch moved without a checkout shows on focus or refresh.

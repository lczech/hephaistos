# Views

What each kind of View shows, and what they share.
Each kind has a folder in `views/` ([layout](layout.md#views-and-dockview)).

## Shared

### View bars

A View starts with its bar (`ViewBar`): what it shows or compares first, its toggles and links at its end, as icons alone.
The buttons at its end come in groups, a line between two (`BarGroup`), always in this order, also in Views to come:
1. Toggles: buttons that switch a state of the View and show it, find first (hidden files, side by side, all files unfolded, layout).
2. Actions: buttons that do something once (close all folders, Refresh).
3. Other Views: the links to them.
A group without buttons leaves no line.
Below it, the View fills the rest of its Panel (`ViewPage`).

### Commits

A commit is named as its icon and short hash, as text, then a pair of links: its Changes, then its Diff (`CommitHash`).
They line up in lists.
Pickers' lists, which offer choices, show no links; nor does a commit's line in a bar, which already links to the other View.
Lists of commits are one component (`views/commits/CommitList`), with the commit box and the line of a commit in a bar (`CommitBox`, `CommitHeader`).

### Changes and Diff as a pair

Changes come as a pair wherever a commit's or a Checkout's uncommitted ones are linked: Changes, then Diff, all files one under the other (`views/comparison/ChangesLinks.tsx`).
The links are greyed out where there are no changes.

### Comparisons

The Changes and Diff Views show first in their bar what they compare.
That is two Revisions picked (`from` ⇄ `to`), swapped by a button between them.
For a commit (`commit=`), it is the commit's line in their place, opening all about it below the bar, with a button to pick other Revisions instead, from its first parent.
Without `from` and `to`, Changes shows HEAD → working tree, in `git status`'s groups or together.
That toggle is at the bar's end, offered only for that pair, and kept per browser (`hephaistos.changes`), as the Diffs' look is.
Directories show each by its path or nested in their parents, a toggle in both Views' bars; in the Diff's only for all files, whose order it sets.
A directory holding a single directory and nothing else is joined with it: `src/hephaistos/`.
The choice is kept per browser with the other.
Below, what the comparison holds, its files and lines, is the first row of the list or the stack.
Its lines line up with the rows' and headers', scrolling with them.
A Diff's file header names the file and its lines, not the comparison again.

## Repositories

The Repositories View lists the Repositories, their Clones and Worktrees as a tree, each with its state and activity.
A Checkout's row links to its Events and its files in the Explorer, then to what git has of it: its History, Graph, Changes and Diff; that of a Worktree to the Graph of its Clone, at its HEAD (`at`).

## Events

The Events View lists Events, newest first, filtered by priority, time, kind, Repository, Machine and subject: the parameters of `/api/events`, by the same names.
A row opens the Event's details.

## Log

The Log View lists this Machine's log records, filtered by level, time and process.
A row opens the record's details.
Later, another Machine's log comes from its Server: `log?machine=…` ([ADR 005](../../decisions/005-gui.md)).

## Config and Daemon

The Config View lists the settings, with their values and where each comes from.
The Daemon View shows the Daemon's process, Watcher and Server, and what to check when it cannot be reached.
It observes on request.

## Database

The Database View lists the database's tables, as `hephaistos db tables` does, each row led by a sheet.
A row shows its table's rows in place, as the table picker in their bar does; its first entry, All tables, goes back to the list ([interaction](interaction.md#in-place-or-another-view)).
A table's rows come newest first, with their columns as the Server describes them, and open their details.

## Changes

The Changes View lists the files a comparison changes, grouped and nested as chosen ([comparisons](#comparisons)).
A file's row opens its Diff; directories and groups fold.
Untracked files and new folders, which may be anything left lying about, come last.

## Diff

The Diff View shows git's patch of one file (`diff?clone=…&from=…&to=…&path=…`).
Without `path`, it shows a stack: all files of the comparison or commit one under the other, in the order Changes lists them.
Changes links to it at its bar's end.

### Words

- *The lines of a diff*: those of the patch, with `gui.diff.context` lines around each change.
- *Collapsed* lines: the unchanged ones left out between changes or up to the file's end, once *expanded* by their *separator*, a bar standing in for them ([interaction](interaction.md#fold-collapse-expand)).
- A single collapsed line shows instead, once the file's versions are known (`UNCOLLAPSED`).
- With *Whole file* on, all lines show, expanded.
- *Drawn*: lines the renderer has made elements for, those near the view (its `Virtualizer`); only what is shown on them, e.g. find's marks, depends on it.
- *Fold*: a file or directory in a stack reduced to its header; its lines still belong to its diff. Folding lets go of its diff: unfolded, its expanded lines are collapsed again.
- *Large diff*: one with more lines changed than `gui.diff.large_lines`, which waits to be shown by its button, so that drawing it cannot slow down the page unasked; Whole file does not show it.

### Rendering

A diff is filled in with the file's two versions, asked for after its patch.
So it says how many lines it leaves out up to the file's end, and its collapsed lines expand.
It is rendered by `@pierre/diffs`, pinned, imported only by `components/diff/` and loaded once a diff shows.
Shiki highlights it with the themes `gui.code.theme_light` and `gui.code.theme_dark` name, on the page's background, in Web Workers.
A diff shows as plain text until its colours come.
Its header is ours, as the file's row in Changes shows it, and stays in view below the View's bar while its diff does.
Separators show as quiet gaps between two lines, not the renderer's bars, so that where a file starts stands out.
An empty diff offers where the file's changes are now, in the same Panel.

### Stacks

Each file is as high as its lines are likely to be until it comes near the scrolled area; then it is asked for and shown with its versions.
Asked for again, e.g. on focus or a live hint, a new patch shows once its versions came too; unchanged ones leave it as it is.
It is held as high as its patch's rows and separators make it until drawn, so that it changes height once, if at all (`components/diff/height.ts`).
Once asked for, it is kept however far it is scrolled.
Files show under their directories' headers, nested in their parents' as Changes nests them; the headers stay in view above the file's header and line up with it.
A click on a file's or directory's header folds it, and another unfolds it, a directory's files as they were.
What is folded stays so in all the Checkout's Diffs, in every comparison, until unfolded, kept per browser (`hephaistos.folds.diff`).
The Changes View keeps its own folds so (`hephaistos.folds.changes`).
Each part of a View folds apart from others showing the same directories: the stack and its untracked files, each group of Changes.
A directory's fold holds for all below it, however its header reads; one by its path below a folded one says so, and shows with it.
A toggle in the bar folds all files at once, leaving their headers as an index, or unfolds all; neither is on while mixed.
Untracked files and new folders come last, listed as Changes lists them, each file's diff shown below its row once opened, or all at once.

### Look

Diffs show side by side or inline, wrapped or scrolled, Whole file or not: chosen for all Diffs, kept per browser (`hephaistos.diff`).
Narrow Panels show diffs inline.
A new or deleted file's lines go on their own side, as other files' are.
Turned off, Whole file starts the diff anew, as the renderer cannot collapse lines again.

### Finding

A Diff finds in the lines of its diffs ([interaction](interaction.md#find)): those of one file or of a stack, wherever the diff is scrolled and whether its file is folded.
A drawn diff's renderer says which lines it has.
A stack's files are asked for all at once as the find row opens, with their new versions, page by page (`/api/diffs`).
They are searched in the stack's order, untracked files only while their rows are open, after the others.
Stepping to a match in a folded file unfolds it, and in a large diff shows it, for good, as a click would; typing leaves them.
Matches are marked in the renderer's shadow DOM, again as it draws.

## History

The History View lists a Checkout's commits as `git log` walks back (`history?clone=…`).
It starts from HEAD or a branch, tag or commit picked (`ref`, HEAD as none, following what is checked out).
It lists by date, newest first, or topologically, each line of commits together, a toggle in its bar (`order=topo`, by date as none); either lists each commit below its children, as the graph needs.
It shows all files or one path (`path`), a file's renames marked where they happened.
A search (`search`) keeps only commits whose message has all words searched for, in any order and case.
For a hash, its commit comes first; else it says where it is: on other branches, offered to show it there, or not changing the path, offered with all files.
The refs of a commit show as small badges framed in orange before its subject, each with its icon: HEAD, branches, remote branches, tags; with the graph, that of a branch in the colour of its line ([the graph](#the-graph)).
On a row, at most two show, HEAD and then main or master first, so the subject still shows; the rest are counted, named on hovering, and all show in the commit box.
A row opens all about its commit: the commit box, also under a commit's Changes and in a commit Event's details.
While HEAD's commits show, a row above them says what is not committed, with its Changes and Diff.
A commit's Changes and Diff (`changes?clone=…&commit=…`, `diff?…&commit=…`) are against its first parent.
They say if no branch or tag leads to the commit any more, and what amends of it led to.
History opens from the row of a Checkout in Repositories, and from the bars of its Changes and of a file's Diff; its bar links to the Graph of its Clone.

### The graph

Beside the commits, their graph (`views/commits/`): a lane per line of commits, drawn down from a commit to the parent it waits for.
It shows by default, hidden or shown again from the header menu, which never moves it: it stays after the square, so that what opens below a row lines up with it.
It is drawn only where every commit listed comes above its parents and none is left out between, so not for a path or a search.
The column fits the lanes of the rows loaded, up to eight, until resized; lanes beyond its width are cut off.
Lanes are laid out row by row (`lanes.ts`): a row depends only on those above it, so a page loaded on scrolling goes on with the layout, and rows drawn never change.
Lanes waiting for the same parent stay apart until it comes, so that a branch joins another where it left it; lanes keep their column, so lines are straight.
Where a lane passes a row is kept once per lane, as the rows it spans, so that a row looks up only its own.
A commit listed below its parent, as the default order of git may list with clocks apart, draws no line to it rather than one that never ends.
Each row draws its part across its whole height (`Graph.tsx`), in two lines too; the node is in the middle of its first line; lanes go on beside the details opened below it.
Nodes are drawn as most graphs draw them: a commit a dot, a merge a ring around a dot, HEAD a larger, thicker ring, what is not committed a dotted ring, joined to HEAD by a dotted line.

Colours:
- the line of the start, in lane 0, takes the accent;
- a lane a branch starts takes a hue from the name of the branch (`hues.ts`), the same in every session, at the lightness and chroma of the theme (`--hue-*` in `theme.css`);
- a lane no branch starts, e.g. the side of a merge, takes a muted hue, from the commit it leads to, so that it stays as pages load;
- the badge of the branch leading a line, and of its remote-tracking branch, is framed in the colour of that line.

Words:
- *Lane*: a column of the graph, in which a line is drawn from a commit down to the parent it waits for.
- *Passing*: a lane neither ending nor starting in a row.

## Graph

The Graph View shows the commits of a whole Clone with their graph (`graph?clone=…`), as History shows them ([the graph](#the-graph)), from the same list (`views/commits/`).
It walks all local branches and the HEAD of each Checkout of the Clone, detached ones too, less the branches hidden (`hide`): `/api/history` with `branches=local`.
Or, Worktrees only (`branches=worktrees`), the branches checked out in its Checkouts and the default branch: where the Checkouts stand, in the fewest rows.
The branch filter, a picker at the start of its bar, chooses which: it lists the branches walked, the default one first, each shown while ticked, with "only" to hide the others, and "Show all".
Hidden branches are kept by name, so that a branch made later shows; a hidden branch still shows its commits where a shown one leads to them, as the filter says, but no badge, and names no lane.
It lists topologically by default, or by date (`order=date`).
Its default branch keeps lane 0 and the accent, pinned to the left from the top, as `/api/graph` names it, unless hidden, when no line has the accent; the HEAD of each Checkout is drawn as HEAD.
Its bar has the order, the look of the list and a refresh, which asks again for the commits and for `/api/graph`; both are asked again as History is, and when the GUI regains focus.
A branch moved without a checkout, e.g. by `git branch -f`, shows only then: the Watcher reads the reflogs of HEADs.
The tab says `Graph: proj`, whether it shows Worktrees only, and how many branches are hidden.

Its Checkouts:
- the badge of a branch checked out says where, by the icon and name of the Clone or Worktree; a detached HEAD has a badge of its own, `detached`, with the HEAD icon and where; badges come first for the default branch, then for branches checked out, other local branches, remote-tracking ones and tags;
- what is not committed in a Checkout, from its State, has a row above its HEAD, with links to its Changes and Diff;
- below the bar, a chip per Checkout, neutral as the bar's buttons, marked at its start in the colour of the line its HEAD is on, as its badge is framed: its name, its branch or `detached at abc1234` in the words of git, and how far it is ahead of the default branch and behind it (`↑3 ↓12`, zero parts left out; the default branch against its upstream), said in words in its tooltip;
- the lines of the HEADs come from `/api/graph/lines`, laid out ahead of the list as it will lay them out, up to 10,000 commits, until all HEADs have come: a line's colour comes only from the rows above it, a HEAD's line may be another branch's, and a HEAD may be far below the first page; until then a chip has no mark, but on the default branch the accent, whose line is pinned from the top;
- a click on a chip goes to its HEAD: older pages load until its row is listed, then it is scrolled to the top, with what is not committed above it; after 300 ms, as most are done by then, the chip turns, its tooltip and a live region saying how far, and a click on it stops, as Escape in the View does; its chip says with a warning if no page lists it; a note above the list would move it;
- the chip of the Checkout the Graph is at is marked, filled as a toggle that is on: the Clone, or a Worktree (`at`), as opened from its row in Repositories; a click keeps the one it went to in the address;
- the chip of a Checkout whose branch is hidden is faint; a click shows the branch again.
It opens from the rows of Clones and Worktrees in Repositories, and from the bar of History.

## Explorer

The Explorer View shows what a Directory holds, as a tree (`explorer?path=…`), on disk, as `/api/files` lists it: any Directory this user may list, the home directory without `path`.
With `root`, it never shows a Directory above that one, `root` itself without `path` or for a `path` outside it.
`root` shapes the View only: the Server lists any Directory for the Token, as a terminal would.
The bar shows the path, from the name of `root`, else from `~` under the home directory, each part showing that Directory instead, in the same Panel; it shows once the home directory is known, so that it does not change from `/home/me` to `~`.
"Go into folder", in the menu of the row of a folder, shows that folder instead, as the parts of the path go back up.
Where the Directory shown lies in a registered Checkout, the bar links to its History, Changes and Diff, as the row of the Checkout in Repositories does, before the reload button, as Changes and the Diff place theirs.
Folders come first, then files, by name as people sort them: case ignored, numbers by their value, as VS Code does.
A folder opens and closes; it is asked for once opened, or once pointed at or focused, so that opening shows it at once.
A folder known to show nothing, once its listing came, opened or asked for ahead, or as the size column says `0 items`, has no chevron, keeps its closed icon and opens nothing, as VS Code has it; one holding only hidden entries is so while they are left out.
What is opened is kept per browser for each Directory shown (`hephaistos.folds.explorer`); "Close all folders" closes them.
A folder holding just one folder and nothing else opens through it, the two shown joined: `src/hephaistos`; not a registered Checkout's top, whose row says what it is, nor a symlink, which may lead back to a folder above it.
Hidden entries, whose names start with `.`, show in italics, as the file system hides them; a toggle leaves them out, kept per browser for all Explorers (`hephaistos.explorer`).
Names are coloured as git's letter for them says, as Changes colours its kinds of change: added and untracked green, modified, renamed and type changed amber, unmerged red; folders with changes below them amber.
Ignored entries show quieter, as does `.git`, git's own, so that the colour says what git tracks: a hidden folder git tracks, as `.github`, shows in italics in the colour of the tracked.
A column shows the letter, or a dot for changes below a folder; its tooltip spells out what is staged and what is not.
A file's size shows its amount, then its unit; a folder's, its number of entries, as GNOME's Files shows it, then `items`; either in a box as wide as the widest, so that all numbers line up.
The size and the time last modified are columns hidden until shown, as each costs a `stat` per entry: what a folder holds is asked for twice, its names and kinds to show at once, then git's letters and the shown columns' fields to fill in; showing another column keeps the fields shown until its answer comes.
On a hint or focus, only the second is asked again, as it holds the names too.
Icons say what an entry is: a folder, open or not; a Checkout's top, registered; a symlink, to a file or a folder, or pointing nowhere, in the problem colour; a folder this user may not list (403); else a file's kind.
A file's kind comes from its name: exact names first, ours then GitHub's Linguist's (`CMakeLists.txt`), but for locks and configs, which our extensions say better than Linguist's formats (`uv.lock`); then extensions, our own table first, for binary files and some we show otherwise, then Linguist's, by the language's type or, for a few, the language (`components/files/kinds.ts`).
Extensions Linguist leaves undecided, as languages of different types claim them, are listed in a test, so that an update leaving more fails there.
Files open nothing yet.
Pointing at a row shows its links after its name: its History, inside a registered Checkout or for the top of one, all its files, not for what git ignores or does not track, as it has no commits of those, nor for `.git`, and before it its Diff since HEAD, for a file with changes.
Its menu has them too, after going into a folder, then copying its absolute path, and its path in its Checkout.
What was copied shows in the status bar for a while (`notice.ts`).
A file's row is marked while a Diff of it comparing the working tree, either way, is shown in any Group, from wherever it was opened: it is about the file as the Explorer shows it, on disk; a commit's changes or the staged ones are not.
It is asked again on a hint, on focus and by its reload button.
The Explorer opens from the row of a Checkout in Repositories, limited to it (`root`), and from the View menu, at the home directory.

### Finding by name

The Explorer finds files and folders below its Directory by name, in the find row ([interaction](interaction.md#find)), opened by its bar's button or Ctrl+F.
It matches names as typed, or, where what is typed has a `/`, paths below the Directory: `explorer/col`.
The Server lists every path below once as the row opens (`/api/files/paths`), and the find row's worker matches them, so typing asks for nothing; the list is asked again on focus and by the reload button, not on hints, as listing all may take seconds.
It finds what the tree would show: hidden entries only while they show; what git ignores only with the row's own toggle (`ignored` in the fragment), as ignored folders such as `node_modules` would drown the rest.
The tree shows only the matches, in the folders holding them, each folder its own row, not joined, as each may be a match; a folder matched that holds no other match opens to all it holds.
It shows the first 1,000 paths matched, in the order listed, and the row says so, as it says when listing stopped at `files.max_paths` or after `files.search_seconds`; its limit counts paths, not matches, as a name may match many times.
While it finds again, or lists the paths again below the same Directory, it shows what it found before, in the paths it found it in.
Their rows show at once from the list, their fields once their folders' listings come; a folder holding matches is asked for once its row comes into view, or near it, not all at once.
Until it has found something, it says it is finding, rather than show the whole tree.
The folders holding matches open for the search only, apart from those kept; folding one, or "Close all folders", hides its matches until the search ends or looks for something else, which starts with all its folders open.
Enter and Shift+Enter step through the matches in the tree's order, opening the folders holding the one stepped to and scrolling it into view below the rows stuck above it.
Closing the row shows the tree as kept, with the folders holding the match stepped to opened, scrolled to it.
Showing another Directory searches that one.

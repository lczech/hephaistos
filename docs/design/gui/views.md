# Views

What each kind of View shows, and what they share.
Each kind has a folder in `views/` ([layout](layout.md#views-and-dockview)).

## Shared

### View bars

A View starts with its bar (`ViewBar`): what it shows or compares first, its toggles and links at its end, as icons alone.
Below it, the View fills the rest of its Panel (`ViewPage`).

### Commits

A commit is named as its icon and short hash, as text, then a pair of links: its Changes, then its Diff (`CommitHash`).
They line up in lists.
Pickers' lists, which offer choices, show no links; nor does a commit's line in a bar, which already links to the other View.

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
A Checkout's row links to its Events, History, Changes and Diff.

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
It shows all files or one path (`path`), a file's renames marked where they happened.
A search (`search`) keeps only commits whose message has all words searched for, in any order and case.
For a hash, its commit comes first; else it says where it is: on other branches, offered to show it there, or not changing the path, offered with all files.
A commit's refs show as small badges framed in orange before its subject, each with its icon: HEAD, branches, remote branches, tags.
On a row, at most two show, HEAD and then main or master first, so the subject still shows; the rest are counted, named on hovering, and all show in the commit box.
A row opens all about its commit: the commit box, also under a commit's Changes and in a commit Event's details.
While HEAD's commits show, a row above them says what is not committed, with its Changes and Diff.
A commit's Changes and Diff (`changes?clone=…&commit=…`, `diff?…&commit=…`) are against its first parent.
They say if no branch or tag leads to the commit any more, and what amends of it led to.
History opens from a Checkout's row in Repositories, and from the bars of its Changes and of a file's Diff.

## Explorer

The Explorer View shows what a Directory holds, as a tree (`explorer?path=…`), on disk, as `/api/files` lists it: any Directory this user may list, the home directory without `path`.
Its bar shows the path, from `~` under the home directory, each part showing that Directory instead, in the same Panel.
Folders come first, then files, by name as people sort them: case ignored, numbers by their value, as VS Code does.
A folder opens and closes; it is asked for once opened, or once pointed at, so that opening shows it at once.
What is opened is kept per browser for each Directory shown (`hephaistos.folds.explorer`); "Close all folders" closes them.
A folder holding just one folder and nothing else opens through it, the two shown joined: `src/hephaistos`.
Hidden entries, whose names start with `.`, show quieter and in italics, as the file system hides them; a toggle leaves them out, kept per browser for all Explorers (`hephaistos.explorer`).
Names are coloured as git's letter for them says, as Changes colours its kinds of change: added and untracked green, modified, renamed and type changed amber, unmerged red; folders with changes below them amber.
Ignored entries show quieter, in the regular font.
A column shows the letter, or a dot for changes below a folder; its tooltip spells out what is staged and what is not.
A file's size shows its amount, then its unit; a folder's, its number of entries, as GNOME's Files shows it, then `items`; either in a box as wide as the widest, so that all numbers line up.
The size and the time last modified are columns hidden until shown, as each costs a `stat` per entry: what a folder holds is asked for twice, its names and kinds to show at once, then git's letters and the shown columns' fields to fill in.
Icons say what an entry is: a folder, open or not; a Checkout's top, registered; a symlink, to a file or a folder, or pointing nowhere, in the problem colour; a folder that cannot be listed; else a file's kind.
A file's kind comes from its name: exact names first, ours then GitHub's Linguist's (`CMakeLists.txt`), but for locks and configs, which our extensions say better than Linguist's formats (`uv.lock`); then extensions, our own table first, for binary files and some we show otherwise, then Linguist's, by the language's type or, for a few, the language (`components/files/kinds.ts`).
Extensions Linguist leaves undecided, as languages of different types claim them, are listed in a test, so that an update leaving more fails there.
Files open nothing yet.
Pointing at a row shows its links after its name: its History, inside a registered Checkout, and before it its Diff since HEAD, for a file with changes.
Its menu has them too, then copying its absolute path, and its path in its Checkout.
What was copied shows in the status bar for a while (`notice.ts`).
A file's row is marked while a Diff of it comparing the working tree, either way, is shown in any Group, from wherever it was opened: it is about the file as the Explorer shows it, on disk; a commit's changes or the staged ones are not.
It is asked again on a hint, on focus and by its reload button.
The Explorer opens from a Checkout's row in Repositories, and from the "+" menu.

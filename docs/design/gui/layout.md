# Layout

How Views are placed in Panels and Groups, addressed, opened and kept.
Decided in [ADR 005](../../decisions/005-gui.md); the terms are the [glossary](../../glossary.md)'s.

## Views and dockview

dockview (`dockview-react`) provides Panels and Groups.
Only `layout/` uses it; a lint rule rejects imports elsewhere.
`views/` has a folder per kind of View.
Each kind is named, with its icon, in `views/kinds.ts`, and its component is in `views/index.ts`.
A View gets its parameters as props, with ways to change them and its tab's title.
Views open other Views through `useOpenView` (`views/opening.ts`), which `layout/` provides with our `openView`, never dockview's API.
From within a Panel, a View opens from that Panel's Group.
From elsewhere, e.g. the status bar, it opens from the active Group (`layout/ViewOpener.tsx`).
The status bar's Daemon icon, coloured by the Daemon's health, opens the Daemon View.

## Addresses

A View's address is written as a URL's path, query and fragment, each part's values encoded (`URLSearchParams`), the parameters sorted.
Its kind and parameters say what it shows: `events?repository=…`.
Its fragment says how it is looked at, e.g. sorted or searched: `diff?…#find=beta`.
A parameter with several values repeats: `kind=clone&kind=worktree`.
Each View decides which part a value goes in as it sets it.
What changes which things it shows (a filter, a comparison) is a parameter.
What only changes how they are shown (their order, a search in them) is in the fragment.
Addresses differing only in their fragments name the same View (`viewKey`).
A link to it marks it as shown and focuses it, as it is looked at there.
Going back and forward steps through fragments too.
A Panel keeps its View's address in dockview's Panel parameters, which the View can change, e.g. by filtering, and which are saved with the Layout.
A Panel's ID is random, as a Panel's View can change.
The page's own fragment carries the token (`#token=…`).

## Opening

Each kind that stands alone says where it is offered (`views/kinds.ts`); Changes, Diff and History need a Checkout, so open only from other Views.
The View menu, in the title bar, lists all that stand alone, by family, and opens one in the active Group.
"+" in each Group's tab bar and an empty Group list those at hand: Repositories and Events; the others are only in the View menu.
Views open other Views by links ([interaction](interaction.md#links)).
A link opens by a click in its own Group, and beside it by the middle button or Alt+click, as browsers open a link in place or in a new tab.
Ctrl and Shift stay free for selecting in lists.
Beside is the Group touching it on the right, else below, left or above (`layout/beside.ts`).
Of several Groups on that side, it is the topmost (right, left) or leftmost (below, above), by their sizes on screen.
A Group alone is split, to the right.
Opening a View that a Panel shows focuses that Panel, its tab flashing in the accent for a moment to show where it is.
Two Panels may show the same View.
Later, Views also open from sidebars (dockview's edge groups) and a command palette.

## Columns

The title bar's buttons make one to four columns of Groups side by side, of even widths (`layout/columns.ts`).
They deal every tab, in reading order (left to right, top to bottom), into that many runs, the longer ones first, differing by one tab at most.
So going from one count to another and back gives the same Groups again, while no tab opens, closes or moves in between.
With fewer tabs than columns, the last columns are empty Groups, whatever `gui.keep_empty_groups` says; empty Groups before are dropped.
Each run reuses its first tab's Group, unless an earlier run did, so that the Group keeps its steps back and forward; other Groups close.
Each Group shows the first of its tabs that was shown, else its first; the focus stays on its tab.
No tab stays a preview.
The buttons make no rows; rows made by hand within the columns stay while the button pressed is the one for the current count.
That button is pressed while the top has that many columns, rows within them or not; pressing it again only evens out their widths.

## Dividers

Double-clicking a divider between Groups evens out the split it divides: all its parts, side by side or one above another, not only the two beside it (`layout/dividers.ts`).
Splits within those parts keep their sizes.
Dockview evens out a split's parts as a Group is added to it and removed, so `layout/splits.ts` does that, beside one of the split's own Groups or at the top's edge; the column buttons even out the top so too.
A split of splits only, e.g. two rows of two Groups each, is sized through a Group of each part instead.
Dockview has no event for a divider's double-click, nor a way to name a divider's split, so `dividers.ts` alone reads its elements: its dividers (`dv-sash`) and how its grid nests them.
A browser test keeps watch on both, for when dockview changes.

## Previews

A link opens its View as a preview.
A Group has one preview at a time, which the next preview replaces, also when that preview opened it: the Panel stays and its View changes.
A preview's title is in italics.
It becomes an ordinary Panel once its tab is double-clicked, once it is changed (filtered, sorted, …), or once it is dragged to another Group.
A double click on a link does not keep it, as its second click would land in the View opened.
Whether a Panel is a preview is a Panel parameter beside the parameters of its View, so the Layout keeps it.

## Going back and forward

Each Group goes back and forward through the Views it showed, as a browser tab does (`layout/visits.ts`).
The mouse's side buttons do so over a Group's tabs, its View or its placeholder.
Alt+← and Alt+→ do so in the active Group; the page takes them from the browser.
Each address a Group shows is a step: one in another Panel, or another in the same Panel (a link replacing a preview, a filter, another Revision compared).
Keys typed in a row, e.g. a search, make one step, until typing is done: Enter, or leaving the field (a run's number in `layout/dock.ts`).
Going back shows a View again in its Panel, or as a preview where the Panel is gone.
The steps are kept until the page is left.

## Empty Groups

A Group closes when its last Panel closes or moves away, unless it is the last Group.
With the setting `gui.keep_empty_groups`, it stays, so a Layout keeps its shape (dockview's `closeEmptyGroups: false`).
An empty Group offers the Views at hand.
An empty Group other than the last offers to close; so does Ctrl+W.
Ctrl+W closes the active Panel, or the active empty Group.
Only the Desktop passes Ctrl+W to the page; browsers close their tab.

## Building and keeping Views

A Panel's View is built when its tab is first shown, so a restored tab never looked at costs nothing.
A Diff then asks for no files, and its tab keeps the title its Layout saved.
From then on it stays drawn while hidden (dockview's `always` renderer, for all Panels).
So it keeps its scroll positions, and showing it again lays nothing out anew, e.g. a Diff's lines.
Another View shown in a Panel, e.g. a preview replaced or a step back, is built anew, so it starts at its top, not at the last one's scroll positions (`showIn` in `layout/dock.ts`).
The same View looked at otherwise, e.g. with another fragment, and a View changing itself, e.g. filtered, stay as they are.
Views are drawn over their Groups, not in them, so where an element sits says nothing of its Panel or Group.
Shortcuts act on dockview's active Panel or Group, reaching into a View through its Panel's context.
The mouse's side buttons act on the Group our tab, View or placeholder belongs to.
A lint rule (`gui/lint/dock-elements.grit`) rejects reading dockview's elements.

## Saving

The Layout is kept per browser, in localStorage, with a format number.
A Panel whose kind no longer exists says so.
A View that fails, e.g. on parameters it no longer understands, shows its error in its Panel only.
A Layout that cannot be restored gives the default one.
There are no migrations.

## Later, Workspaces

One window switches between Workspaces, ordered by hand, e.g. one per Repository.
Lists of Repositories are ordered by name or activity instead.
Each Workspace has its own Panels in a named Layout that Workspaces share; at first, all share the same one.
Each Workspace keeps its own dockview, all of them mounted, the hidden ones not asking again until shown.
A shared Layout that changed is applied when its Workspace is shown.

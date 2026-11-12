# Lists

How the GUI's lists work (`components/list/`).

## Tables

TanStack Table (`@tanstack/react-table`, headless) holds a list's columns and their state.
Views render them as CSS grids of their own markup.
Widths reach the grid as CSS variables.
The header and each row lay out the same columns, each on its own, not as subgrids of one grid: so that a change in one row, even its actions shown on hover, does not lay out all the others again.
So a column's width is the same in every row, never sized by its cells (`max-content`); one sized by what it shows is set by its View, as the Changes list's lines (`vars`).
Only the rows near the view are drawn, by TanStack Virtual (`VirtualRows`), in a file that React's compiler leaves out, as it refuses `useVirtualizer`.
Each is measured as drawn, not rounded to pixels, and placed by `top`, so that its text lands on whole pixels, as text moved by `transform` to a fraction of a pixel is blurred.
Rows in view stay where they are as rows come or go before them, put back by their key, as the browser keeps them only where it lays them out itself; at the very top, new rows show.
Until measured, a list is taken as high as the window, so that its first draw shows rows.
A tree's rows are flat, each after the row holding it.
A list that is part of a page, the Diff's untracked files, draws the rows near the view of what scrolls the page.

## Rows

A row opens by the button in its first cell, or by a click anywhere else on it but on its cells' own buttons and links, and not by one selecting text.
What a row opens, and how it shows that, is in [interaction](interaction.md#rows):
- details below it;
- the rows within it, where it folds (`getSubRows`, `data-depth`): the Changes View's groups, directories with changes, and new folders, whose files are asked for once opened;
- another View, as a link does, e.g. a changed file its Diff;
- nothing, where it shows all it has, e.g. a note.

A row may have actions: icons after what names it, shown while it is pointed at or holds the focus of the keyboard, its name then making room, cut off, so that its other cells stay as they are (`actions`).
A View may ask for what a row opens as it is pointed at or focused (`ahead`), and for what it shows as it comes into view, or near it (`seen`): as it is drawn, and again as the rows or what the View asks change.
It may have a menu, by the right button, a long press, or the menu key or Shift+F10 on the row, not in its details (`menu`, `RowMenu`): what can be done with it, in groups, each by its icon, a View's in its family's colour.
The keys move between rows and open them ([interaction](interaction.md#keys)).
The row focused is the only selection (`aria-selected`), by its ID, so that it stays as rows change: once it goes, the row holding it takes the focus, as a folder closed, else the row now at its place, or the one before where it was the last.
A click focuses its row too, its square's button included, so that the keys go on from there; a click within its details focuses them, not the row, so that the keys scroll there as on any page, but for Escape.
Rows are one stop of Tab, the row focused, else the first in view; only that row reaches by Tab what it holds, the others' links and buttons left out while drawn (`data-untabbed`), also those coming later, in shadow DOM too, as a diff's; and the button opening a row never, as the keys do.
The row focused stays drawn while scrolled away, so as to keep the focus.
A ring of the accent colour shows it once the keys moved there (`:focus-visible`), not after a click, nor while the list has no focus; also in Firefox, which shows none on a row focused by script after a click, the list marked while its keys are in use (`data-keys`).
A row that opens a View is marked while that View is shown in any Group, focused or not, as VS Code marks the file of the editor shown (`useIsShown`, from `layout/`).
A commit in History is marked so while its Changes are shown.
Rows may be grouped, a line above each group but the first.

## For screen readers

A list is a treegrid, named by its View (`label`: `Files`, `Events`), as only the rows near the view are drawn: it tells how many rows it has (`aria-rowcount`), and each row its place (`aria-rowindex`), its level (`aria-level`), its place among the rows beside it and how many they are (`aria-posinset`, `aria-setsize`), and whether it is open (`aria-expanded`).
Its header is a row of column headers, saying how the list is sorted (`aria-sort`); a column without a label, as the square, is named for screen readers alone; in two lines, one header cell holds its buttons.
A row's details are a region in a cell of the row, named by the View (`detailsLabel`).
Its rows stuck are hidden from screen readers.
Each row lays out its columns on its own, so the elements are `div`s with roles, not a table's: a list's `ol` and `li` may not take them.
A View's styles find its rows by their level (`[aria-level]`, its value for one level of a tree), which the header row has not.

## Trees

A list's tree knows its rows only as rows holding rows (`tree.ts`, `TreeCells.tsx`), whatever they are.
What a row holds may be asked for once it is opened; notes stand in for it meanwhile, say why it cannot be shown, or how many more there are than listed.
Rows beside each other come in their View's order: by a rank first, whatever the direction, e.g. folders before files; then by the column sorted by, rows without a value last either way; ties by a fallback column.
The order is ours, not TanStack's sorting, as the Diff's stack, which is not a list, shows its files in the same order.
What is folded or opened is kept per browser as named sets of strings (`hephaistos.folds.<name>`), for what the tree shows, e.g. a Checkout: row IDs, or what a View names its rows by, as Changes by paths and groups' names.
A row is a step further in for each level, its chevron moved as far, before what it is, so that its icon starts where its parent's name does.
A tree's square holds only its chevron, a little in from the list's edge and reaching into the gap after it, so that what the row is starts just after it (`tree`).
A list may set its rows closer together (`compact`): the Explorer does, as a sidebar's list will.
A row whose content is open, the rows within it or its details, stays in view below the header and below the rows holding it while that content scrolls past, as VS Code's sticky scroll does; part of a page, at the top of what scrolls the page.
The rows stuck are copies, drawn apart above the rows (`stuck.ts`, `VirtualRows`), as the rows they stand for may be far out of view, not drawn; hidden from screen readers and out of the order of Tab.
A row sticks once scrolled past the header's end, not while in its place, by where it starts itself, not the line above it starting a group; the end of its content pushes it up, sliding out below the rows holding it.
A click on a copy focuses its row, as a click on the row does; the copy itself takes no focus.
The copies lie on one block of the background, from a pixel above the header's end to the end of the lowest: each lies at a fraction of a pixel, drawn at whole pixels on its own, so that the rows passing below would show between two.
A click on a copy scrolls its row to where the copy is, at the top, then closes it; its menu opens there too.
The copies stay by CSS's sticking where the list scrolls itself; part of a page, they are moved as it scrolls, as the list scrolls sideways itself, which makes it the box sticking would hold to.
They move as the list scrolls, as rows are measured anew, e.g. details growing once drawn, and as the header changes its height, e.g. its buttons wrapping.
What a row was told to show is kept outside it, as a row scrolled far away is drawn anew: the large diffs shown in the Diff's List.
What is focused or scrolled to in a row, or in its details, comes into view below those rows, not under them.
A View brings a row into view by its ID (`ListHandle.scrollTo`), as it may not be drawn, by as little as it takes, below the rows that would stick above it: the match the Explorer's find steps to, the untracked file of each match the Diff's find steps to, where that is not drawn (`ListHandle.drawn`).
The header covers the pixel above itself with the background, at its scroll edge, where a row passing below may show when zoomed.
A row's tone is its own, not that of the rows within it.
While the list is pointed at, a thin line runs below each open row's chevron, through the rows within it.

Trees of paths are `components/files/`': the directories flat paths lie in, a directory holding a single directory and nothing else joined with it; folds by path, a folded directory folding all below it; and paths after their icon, the folder quieter.

## Sorting

Columns may sort: TanStack's sorting, off unless a column turns it on; trees order their rows themselves, by it ([trees](#trees)).
The order is in the address's fragment (`sort`).

## Filters

A column's header filters by it.
One choice is for a point on a scale: a priority or higher, since a time.
Any of several is for a set: kinds, Repositories; none means all.
Filters are the View's parameters, by the names of the API's, which filters like the CLI.
So they are saved with the Layout, and the tab's title names them.
A filter may be linked: set only from outside, e.g. by a link, and offered only while set.

## Layouts

A list shows its rows in columns, or each row in two lines.
It is a toggle in its View's bar (Lucide's `table`, and our `TableLines`).
Until chosen, it is as the device starts: two lines where the main pointer is coarse, a phone's or tablet's.
The Changes View's rows stay in one line, so it has no toggle.
The Database View's tables, of any columns, show only in columns.

### Columns

Every column is as wide as set, none taking the rest.
A column's header and cells align left, centre or right (`align`): numbers and times right, so that they line up, `5m ago` under `16d ago`.
Times show as the setting `time_format` says, as in the CLI ([commands](../cli/commands.md#output)): by default relative for the last 30 days, `5d ago`, then the day, `2026-09-05`, as the full dates line up so; in full when hovered (`components/Ago.tsx`).
The Daemon's texts and the status bar say how long ago, whatever it says, as they tell how long something has run.
Wider than the list, they scroll sideways, header and all.
Narrower, the room left stays blank.

### Two lines

A row shows its square and icons beside what it is, its details below, one after the other.
Columns would only line up by chance there.
Times go at the end, where they line up.
The View places the cells, so hidden columns and their order apply only to columns.
The header is a line of buttons instead of the columns' headers:
- one per filter, named by its column (the square's by what it filters: `priority`, `level`), saying what it is set to and opening its choices;
- one clearing all filters, while any is set;
- at the end, the column sorted by, opening the others, each first sorted as its header would, and the direction, turned round by one click.

## Scrolling

A list scrolls itself, filling what its View leaves below its bar (`ViewPage`), so that its header and its sideways scrollbar stay in view.
One that is part of a page, the Diff's untracked files, scrolls only sideways.

## Arranging columns

Column widths can be dragged.
A double click on a column's edge fits it to the cells drawn, those near the view, at most as wide as the list.
A column may be hidden until shown, e.g. one whose values cost to ask for; a View then asks only for the shown columns' (`useHidden`).
In columns, the header's context menu (the right button; a long press on Android) shows or hides columns, moves the one clicked left or right past those shown, and resets the list's look, its layout too.
Dragging a header with a mouse moves its column too (React Aria's `useDrag`, the header row its `useDrop`).
It goes to the gap between the headers shown nearest to where it is dropped, an accent line showing which while dragging.
With a finger, whose long press opens the menu, its ← and → move it instead.
Only columns with a header are arranged; those without (a square, a logo, links) stay in place.
A column saying what a row is (a name, a path, a subject, a summary, a message) always shows.
So does one filtered or sorted by, hidden or not, and the Database View's last one shown.

## Kept

What a list keeps is kept per kind of View in the browser (`hephaistos.lists.<kind>.<part>`): its widths, hidden columns, order and layout.
The Database View keeps it per table; the Diff's untracked files share the Changes View's.
It is shared by all its Panels, and not part of addresses.

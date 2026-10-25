# Lists

How the GUI's lists work (`components/table/`).

## Tables

TanStack Table (`@tanstack/react-table`, headless) holds a list's columns and their state.
Views render them as CSS grids of their own markup.
Widths reach the grid as CSS variables.

## Rows

A row opens by the button in its first cell, or by a click anywhere else on it but on its cells' own buttons and links, and not by one selecting text.
What a row opens, and how it shows that, is in [interaction](interaction.md#rows):
- details below it;
- the rows within it, where it folds (`getSubRows`, `data-depth`): the Changes View's groups, directories with changes, and new folders, whose files are asked for once opened;
- another View, as a link does, e.g. a changed file its Diff;
- nothing, where it shows all it has, e.g. a note.

A row that opens a View is marked while that View is shown in any Group, focused or not, as VS Code marks the file of the editor shown (`useIsShown`, from `layout/`).
A commit in History is marked so while its Changes are shown.
Rows may be grouped, a line above each group but the first.

## Sorting

Columns may sort: TanStack's sorting, off unless a column turns it on.
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
A double click on a column's edge fits it to its loaded cells, at most as wide as the list.
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

# Interaction

What the GUI's elements do when clicked or typed at, and the words for them.
These words are lowercase design words for the GUI; the capitalised terms are the [glossary](../glossary.md)'s.
How each looks is in [looks](looks.md).

## Words

### Links

A link shows something: another View (`ViewLink`), or a page outside the GUI (a forge's logo, `ForgeLink`).
A click opens it in its own Group, the middle button or Alt+click beside it ([layout](layout.md#opening)).
A link to a View that needs no look is greyed out, e.g. a Checkout's changes when it has none.

### Buttons

A button does something in place and has no state: refresh, close, swap, the next match.
An icon alone is an `IconButton`; words are framed, maybe after an icon (`.action` in `components/controls.module.css`).
No button is filled.

### Toggles

A toggle (`Toggle`) has a state.
It has one icon where it turns something on or off, e.g. matching case.
It has two icons where it switches between two separate modes, e.g. side by side or inline; the mode in effect shows as on.
This is a guide, not a strict rule.

### Pickers

A picker is a framed field that opens a list to choose from: a Revision picker, a filter's button in two lines, the sort in two lines, the Database View's table.
The last two are `Picker` (`components/Picker.tsx`), our own, as the browser's `select` doesn't follow the GUI's look; one-choice filters share its menu (`PickMenu`).

### Rows

A row of a list is one of four kinds:
- with a chevron in its first column, it opens its details below it;
- with a chevron, it folds the rows within it;
- with another icon in its first column, it opens a View, as a link does, and is marked while that View is shown;
- with nothing in its first column, it is plain and does nothing.

Every row is filled grey under the pointer, so that a long row reads as one.
Only rows that do something show the hand cursor.
How lists work is in [lists](lists.md).

### Icons

Where space is short or icons repeat, they stand alone, named by their tooltips: a column of icons down a list's rows, a View's bar, a set of toggles and buttons.
Where there is room and their names help, icons carry their names: a single link, a short list of Views, a menu.
An icon beside data (an Event's kind, a subject's type, a commit's hash) labels it and does nothing.
This is a guide, not a strict rule.

An icon in a View's colour leads to that View ([looks](looks.md#fills-and-colours-by-state)).
Grey icons work within their own View: toggles, filters, copying, layout.

### States

- *Hover*: under the pointer.
- *Focus*: where the keys are; in menus and pickers, the pointer moves it too.
- *On*: a toggle's lasting state.
- *Marked*: content shown as current, e.g. a row whose View is shown, the Revision picked.

### Fold, collapse, expand

- *Fold*: a row, file or directory reduced to its header by a click on it, its contents hidden; another click unfolds it.
- *Collapse*: unchanged lines of a diff left out, a separator standing in for them.
- *Expand*: show collapsed lines again, by their separator.

Lines collapse; rows, files and directories fold.

## In place or another View

A link shows another View.
A View changes itself, in its own Panel, only through its own parameters: a filter, a Revision picked, a table of the database.
The Group's back (the mouse's back button, Alt+←) returns from either.

## Wording

The GUI's text is in sentence case, its terms lowercase: "this checkout", "No events match", "Open a view".
A View's name keeps its capital where it names that View: "the Daemon view", tab titles, the "+" menu ([glossary](../glossary.md)).

## Tooltips

Tooltips are native (`title`).
An icon alone has its label as its tooltip.
A cell has its own where it adds something (a full time, a status spelled out), else its whole text, as it may be cut off.
A list's header says what the column shows, if its label doesn't.
A tab's tooltip is its whole title.

## Keys

- Ctrl+W closes the active Panel, or the active empty Group; only the Desktop passes it to the page ([layout](layout.md#empty-groups)).
- Ctrl+F goes to the active Panel's search field, the one its View names (`views/keys.ts`), or presses the button opening it, e.g. the Diff's find bar; else the browser finds in the page.
- Alt+← and Alt+→ go back and forward in the active Group ([layout](layout.md#going-back-and-forward)).

Keyboard navigation in lists comes later.

## Controls

React Aria Components (`react-aria-components`, unstyled), styled with our tokens, provide controls beyond the browser's own.
Menus and popovers open by our own buttons (`Pressable`), for their tooltips: the "+" menu, filters (a menu for one choice, a dialog for many), the header menu.

### Search field

A search field (`components/SearchField`) puts its text in the View's parameters at each key.
The View asks with it once typing pauses (`useDebounced`), or on Enter.

### Revision picker

A Revision picker (`components/GitRevisionPicker`) has fixed rows (working tree, index, HEAD) and tabs of branches, tags and commits, as each use chooses.
All comes first: a few of each, with a row leading to their tab.
Typing shows All, filtered.
Refs are filtered in the browser and ranked: the same name, starting with it, at a word's start, within.
Commits are searched by the Server, from HEAD or everywhere.
An exact name, or a hash's commit, comes on top.
A kind's tab lists all of it, virtualized; commits load more on scrolling.
Enter picks the first row; with none, it resolves the text as git does.
Ctrl+← and Ctrl+→ move between tabs.
Refs are named by their full names (`refs/heads/main`), never mistaken for another ref or a Revision, and shown short.

## Find

Find searches a View's content from a row below its bar (`components/find/`), opened by a button at the bar's end or Ctrl+F.
The Diff is its first user ([views](views.md#diff)); Terminals and files are to follow.
It matches as typed, or matching case, whole words, or a regular expression.
Regular expressions are JavaScript's, with `\w`, `\b` and `\d` meaning words and digits in any script, as whole words do.
It says which match of how many, from the first.
Enter and Shift+Enter go to the next match and the one before; Escape closes the row.
Matches are marked on what is drawn, the current one stronger, its line too, by the CSS Custom Highlight API.
The current match is brought into view, also from lines not drawn yet.
What is looked for is in the address's fragment while the row is open (`find=`, and `case`, `word`, `regex` while on); the current match isn't.
Matching runs in a Web Worker, ended after 5 s, so that a regular expression running away can't hang the page.
It runs on the page only where there are no workers (WebKit's tests).

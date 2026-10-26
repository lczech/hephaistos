# Looks

How the GUI looks, and where each look is set.
The words for elements and states are [interaction](interaction.md)'s.

## Styling

Styles are CSS modules and the custom properties of `theme.css`, with VS Code's greys.
dockview's light theme gives sizes, with its colours from `theme.css` (`layout/dock.css`), so it follows the system's light or dark.
Each look is set in one place.
`theme.css` names the colours, sizes, widths, opacities, weights and fills.
The controls' looks are in `components/controls.module.css`: icon buttons, word buttons, fields, menu items.
Text's looks are in `components/text.module.css`: notes, cut-off text, code, figures, dimming, a page's padding.
They are used directly, composed (`composes:`), or through components: `IconButton`, `ViewBar`, `ListTable`.
`ListTable` also draws groups of rows, the quieter second line in two lines, and figures for times and counts, by column ([lists](lists.md)).

### Composing

A class composing a look sets none of its properties again, as the build keeps no order between stylesheets.
Variants go through the custom properties a look reads, which what holds it may set too: `--icon-size`, `--icon-pad-y`, `--icon-pad-x`, `--inline-margin`, `--inline-start`, `--item-padding`.
A second class on the same element names both (`.link.named`).
So a View's bar sizes all it holds alike: its buttons and links as large as a toggle's halves, fields keeping text-sized icons.
Inline styles hand the stylesheets only values known at runtime, as custom properties (`components/cssVars.ts`).

### Enforced

`styles.test.ts` fails on a stylesheet's own colours, sizes, opacities, weights and state fills.
Sizes allowed are 1px hairlines, `ch`, `lh`, percentages and viewport units.
It also fails on a composed property set again.
A lint rule (`gui/lint/inline-styles.grit`) rejects other inline styles.

## Fills and colours by state

- Hover is grey: lighter for rows (`--fill-hover-row`) than for controls, fields clicked to open, and menu items (`--fill-hover`).
- A toggle on is a stronger grey (`--fill-on`).
- Content marked is the accent (`--fill-marked`), the only fill in it: a row whose View is shown, the Revision picked.
- What is on or marked is a step stronger again under the pointer or the keys (`--fill-on-hover`, `--fill-marked-hover`).
- Keyboard focus outlines a control in the accent.
- A resize line is grey under the pointer and the accent while dragged.

The accent, orange, marks important current state, in the GUI or coming from git.
It is the highlight colour for what should be visible at a glance.
In the GUI: a row whose View is shown, keyboard focus, a filter in effect and the button clearing filters, a drag in progress, the tab of a View just focused.
In git: the refs at a commit, HEAD's too.
A toggle on is grey.
Nothing else is orange.

Lines between Groups and between a list's groups of rows have their own colours (`--divider`, `--line`).

## Icons

Icons are monochrome, from Lucide (`lucide-react`).
One thing has one icon, defined once in `icons.tsx`: Event kinds, actions and entity types, a dot for anything else.
A test requires one for every Event kind and chassis.

### Entities

- A Repository is a book; the Repositories View two books, as several of them.
- A Clone is a git folder; a Worktree a folder tree.
- A Filesystem is a drive; a Mount a linked folder.
- A Machine is its chassis: a laptop, a monitor, a server, a box for a vm or container, …; a computer if unknown.
- A commit is git's commit (Lucide's `git-commit-vertical`); the History View two on one line, following each other as it lists them, drawn as Lucide would (`drawnIcons.ts`, as the stacked Diff's several pages).
- HEAD is a circle with a chevron up; a branch is git's branch, a remote branch a cloud, a tag a tag: in pickers, badges and Events alike.
- git's branch icons stay for branches, and for a graph of them, if one comes.

### Actions

Registering and unregistering show the entity's icon with + and − where Lucide has one (book, folder), else a square's.
git adding and removing show a diamond's, after git's logo.
What observing finds shows a circle's (missing, found).
Entity icons show where a row's type isn't otherwise clear, e.g. an Event's subject, not in the Repositories tree.

### Placing

Icons beside text sit a little above the middle of its capitals, by two values in `theme.css`: `--icon-drop` inline, `--icon-lift` when centred.
There are no nudges per icon.
A `TextIcon` (`components/TextIcon`) lines up either way, sized by its context (`--icon-size`).
An icon beside text labels it and does nothing on hover.
An icon alone is a button or link, muted until hovered or focused, its label its tooltip ([interaction](interaction.md#icons)).

### Logos

Brand logos are only for links to forges (`forges.ts`), from Simple Icons (`simple-icons`, CC0, imported one by one).
Each kind of View has an icon, shown before its tab's title (`layout/ViewTab.tsx`, around dockview's own tab) and in the lists of kinds.

## Text

What Views show takes its size and font from `[gui.text]`, code from `[gui.code]` (`look.ts`).
Tabs, View bars and the status bar keep theirs, so zooming isn't needed to read.
Monospace among text is a little smaller (`--mono-size`), as its letters look larger.
Tabs are at most `--tab-width` wide, a longer title cut off.

## Toggles

A toggle (`Toggle`, in `components/ViewBar.tsx`) of one icon looks as an icon button does, grey while on.
A toggle of two modes shows both icons side by side, framed, each with its tooltip, the one in effect grey; a click switches to the other.
A mode chosen that waits, e.g. side by side until the Panel is wide enough, shows on but faint, its tooltip saying why.
In a View's bar, a line parts the toggles from the links after them.

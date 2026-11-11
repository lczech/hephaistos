# Data

How the GUI gets the Server's answers, keeps them current, and what it keeps in the browser.

## Live updates

The GUI asks the Server again only when its live connection hints at a change, never on a timer (`api/live.ts`).
`api/live.ts` maps each hint to the queries it covers, by the names in `KEYS`.
The versions of a file are asked again only after its patch, which they follow, so a hint asks for them once: their key (`VERSIONS_KEY`) is not among `KEYS`, so that no hint, focus nor connecting names them.
A query still loading anew when a hint, focus or connecting asks again is not cut short, but asked again once it ends, once for all that came meanwhile: hints come up to once a second, and a list of many pages may take longer, which would then never end, nor load its next page.
Connecting asks again for everything shown, as hints may have been missed meanwhile; the rest is asked again once shown.
Each time the page gains focus, it asks again for what changes by hand: the settings, and the working trees of Checkouts (their changes, Diffs and files), as editing a file changes no State.
At most every 10 s, it also asks for a pass, and again for commits, as the History and Graph Views show them: they change only with git activity, which the pass finds and hints at too.
Focus is TanStack's `focusManager`, for which the page's window gaining it counts too, e.g. back from the editor.
Answers stay current while a View shows them, until a hint, focus or connecting asks again (`staleTime: Infinity`).
One that no View has used for 5 minutes is dropped (the default `gcTime` of TanStack), and asked again once shown.

## While the next answer loads

A View whose parameters change, e.g. another branch, filter or file, keeps showing the answer before, greyed out, until the new one arrives: History, Changes, Diff, Events and the Log.
Its bar and title show what was asked at once; what the answer shows is all of that answer, never mixed with what was asked next:
- its rows, and what their texts and links say, e.g. on which branch a commit was found, or which commit a file's diff opens in, follow the query it answers, which History and Changes keep with their answers;
- a message about an empty list says that it is loading, or names what was answered, never the filters asked for next;
- finding in a diff waits for the diff of the file asked for.

A refetch with the same parameters, e.g. on a live hint, keeps what shows, the current match of Find included ([interaction](interaction.md#find)).

## Connection

The live connection reconnects after 1, 2, 4 … 30 s, and at once on focus.
25 s without a heartbeat count as lost.
The status bar says live, or since when disconnected; the health icon turns lost, and the Status View says what to check.

## Failed requests

A View of a Checkout notes a failed request above what it showed before, which stays, greyed out (`views/CheckoutError.tsx`).
Once the Checkout is gone, removed or its Clone unregistered, the Server answers 410, and the View says so in place of all it showed.
Either way, it links to the Events that tell what happened.

## Kept in the browser

Per browser, in localStorage, and not part of addresses:
- the token (`hephaistos.token`), taken from a link's `#token=` and forgotten once the Server refuses it ([Server](../daemon/server.md#sending-the-token));
- the Layout (`hephaistos.layout`; [layout](layout.md#saving));
- lists' widths, hidden columns, order and layout (`hephaistos.lists.<kind>.<part>`; [lists](lists.md#kept));
- the Diffs' look (`hephaistos.diff`) and the Changes View's (`hephaistos.changes`);
- what is folded or opened (`hephaistos.folds.diff`, `hephaistos.folds.changes`, `hephaistos.folds.explorer`), and the Explorer's look (`hephaistos.explorer`).

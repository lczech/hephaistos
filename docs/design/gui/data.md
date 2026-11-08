# Data

How the GUI gets the Server's answers, keeps them current, and what it keeps in the browser.

## Live updates

The GUI asks the Server again only when its live connection hints at a change, never on a timer (`api/live.ts`).
`api/live.ts` maps each hint to the queries it covers, by the names in `KEYS`.
Connecting asks again for everything.
Gaining focus asks for a pass, and for what changes by hand: the settings, and Checkouts' changes, as editing a file changes no State.
Focus is TanStack's `focusManager`, for which the page's window gaining it counts too, e.g. back from the editor.
Answers stay current until then (`staleTime: Infinity`).

## Connection

The live connection reconnects after 1, 2, 4 … 30 s, and at once on focus.
25 s without a heartbeat count as lost.
The status bar says live, or since when disconnected; the Daemon's icon turns lost, and the Daemon View says what to check.

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
- what is folded (`hephaistos.folds.diff`, `hephaistos.folds.changes`).

# Ideas: the Daemon

## The Watcher on change

Agreed 2026-10-15, for a step near Terminals and Agents ([roadmap](../plans/roadmap.md)).
inotify (e.g. `watchfiles`) on `HEAD`, the refs, the reflogs and the `index` of each Checkout, with a pass about 1 s after a change.
Edits to files stay on the timer, and so do network filesystems.
The user declined a shorter `watcher.interval` meanwhile.

Also: a pass narrowed to some Clones, e.g. by a refresh button on one (from the ADRs).

## The Server

- A login page with a field to paste the Token into, besides `#token=` links (the first link lands in the history of the browser).
- An `Origin` check for the endpoints that write; live connections have one already.
- The capabilities of the Machine in `/api/info`.

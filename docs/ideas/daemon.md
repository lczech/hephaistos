# Ideas: the Daemon

## The Watcher on change

Agreed 2026-10-15, for a step near Terminals and Agents ([roadmap](../plans/roadmap.md)).
inotify (e.g. `watchfiles`) on `HEAD`, the refs, the reflogs and the `index` of each Checkout, with a pass about 1 s after a change.
Edits to files stay on the timer, and so do network filesystems.
The user declined a shorter `watcher.interval` meanwhile.

Also: a pass narrowed to some Clones, e.g. by a refresh button on one (from the ADRs).

With it, branches moved without a checkout (`git branch -f`, `update-ref`, a fetch into a local branch) could reach the Graph View and History, which until then show them only on focus or refresh (user, 2026-11-12).
A change to the refs then brings a pass, but a pass hints only where State changed, and State has no branch tips: a digest of them in the State of the Clone, from the `for-each-ref` that lists the branches in each pass, would add the change.

## Events of discarded changes

An Event for uncommitted changes discarded, e.g. by `git reset --hard` or `git checkout -- <path>` (user, 2026-11-17).
The HEAD reflog cannot give it: it writes the same `reset: moving to HEAD` for `reset --hard`, a plain `reset` and `git stash`, and says nothing of the changes; those resets record no Event, as HEAD stays.
It would come from the Checkout's status instead: changes there in one pass and gone in the next, with HEAD where it was and no stash added.

## The Server

- A login page with a field to paste the Token into, besides `#token=` links (the first link lands in the history of the browser).
- An `Origin` check for the endpoints that write; live connections have one already.
- The capabilities of the Machine in `/api/info`.

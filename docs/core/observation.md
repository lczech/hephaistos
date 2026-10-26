# Observation

How the Core observes Checkouts and turns what changed into State and Events ([ADR 003](../decisions/003-core.md)).
The Watcher runs it ([Watcher](../daemon/watcher.md)).

## Observers

An observer observes one kind of thing.
It takes a snapshot, and the State compares it with what is stored, writing the changes and recording their Events.
Observers know nothing about timing.
Each observation updates `observed_at`; rows and Events change only when something changed.

## Clones

The first observer is `clones` (git), which also finds the Clones' Worktrees.
git runs outside any transaction, for several Clones in parallel, each command with a timeout (`git.timeout`).
Then one write session stores the results, keeping any State another process observed meanwhile.
Commands run with `GIT_OPTIONAL_LOCKS=0`, so they never block the user's own.

## Conditions

Conditions come from comparing State:
- `missing` and `found`;
- `failed` and `recovered`; while missing or failed, the rest stays as last known;
- branches created or deleted;
- remotes changed.

Status counts, head and upstream only update State.
File names are not stored: Views of files ask the Machine's Server live.

## Git activity

Git activity comes from git's reflogs (`git log --walk-reflogs`).
Each Checkout has a cursor per reflog: the last entry read, by its time and a digest, so that expiry doesn't move it.
If its entry is gone, reading continues after its time.
The first read starts at the end, as `clone register` observes right away.
With `clone register --import-history`, it starts at the beginning.
A Worktree found later starts at the beginning, as all of its reflog is new.

HEAD's reflog gives:
- `committed`, also for amends (with the commit they replace), cherry-picks, reverts and `am`;
- `merged`, `pulled`, `rebased`, `reset` and `branch_switched`;
- `head_moved`, with git's message, for what we can't name.

A `committed` Event carries the message's body from the commit, which the reflog lacks, so the Event outlasts the commit.
A rebase folds into one Event; while one is in progress, it waits.
Resets that don't move, e.g. by `git stash`, are skipped.

Remote-tracking reflogs give `clone.pushed`; fetches are skipped.
A new branch's reflog gives its creation time and start, or shows that it was renamed (`clone.branch_renamed`, instead of deleted and created).

Reflog messages are git's text, stable in practice but unspecified; tests pin them with real git.
Bare repositories keep no reflogs by default.

## Activity

A Checkout's activity (`active_at`, "active" in lists) is when HEAD last moved.
It is the time of the newest HEAD reflog entry read, from `head_log`, by git's clock; unknown without a reflog.
A Repository's activity is the latest of its Checkouts'.

## Viewing

Views show stored State with its age.
`--refresh` observes first, in a separate write session.
Views also observe first, saying so, when git knows a Checkout that the record misses, e.g. a Worktree not observed yet.

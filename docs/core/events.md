# Events

How Events are named, stored and listed ([ADR 003](../decisions/003-core.md)).
`hephaistos event` lists them ([commands](../cli/commands.md#event)).

## Kinds

Kinds are a `StrEnum` in `events/kinds.py`, stored as dotted text, e.g. `clone.branch_created`.
They are in the past tense, as they are facts; requests (later, e.g. `terminal.open`) will be imperative.
The prefix gives the subject's type.
Kinds unknown to this version, from newer Peers, are kept and shown raw.

## Subjects

The subject is always an ID.
`events/subjects.py` maps each subject type to its module.
That module names its subjects and finds their Repository.
Machines, Filesystems and Repositories are named by their name (e.g. a Repository's current one); Mounts, Clones and Worktrees by their path.
Deleted records keep theirs.
Subjects of unknown types show their short ID.

## Payloads

A Registry Event carries the record or its changes ([data](data.md#registry-tables)).
Other kinds have one payload dataclass each.
Other related IDs go into the payload.

## Priority

Priorities are low 10, normal 20, high 30 and urgent 40.
The origin sets each from a default per kind.
High and above will be pushed right away.

## Keys

Conditions are facts about what one Machine sees.
Git activity, and branches created or renamed, are facts about the repository, which several Machines may read on a shared Filesystem.
These carry a `key`: 16 bytes of SHA-256 over Clone, Worktree name, ref, git's time, and what changed.
Others have no key.
With Sync, an arriving Event whose key exists marks the one with the larger ID as a local `duplicate`, which listings leave out.

## Times

`occurred_at` is when it happened, by its source's clock, in milliseconds.
It is NULL where unknown, e.g. for conditions found between two observations.
Git activity has git's time.
`recorded_at` stays the order for Sync.

## Listing

Events are never rewritten: one Event per fact.
Listings group them:
- runs of one kind and subject, e.g. 12 commits;
- a condition with its resolution, e.g. missing, then found;
- chains, e.g. the amends of a commit.

# Ideas: other Machines and Sync

For the step of other Machines and Sync, with the Machines View ([roadmap](../plans/roadmap.md)).

## Sync

- Duplicate Events (decided 2026-10-07). Several Machines that mount one Filesystem (login nodes of a cluster) observe the same reflogs.
  git activity Events and `branch_created` and `branch_renamed` have an `events.key`.
  With Sync, a local `duplicate` column: when an Event arrives whose key exists, the one with the larger ID is marked, and Views filter on `duplicate = 0`; derived locally, not synced.
  Conditions are per Machine, never deduplicated.
  Deleted branches, Worktrees added or removed, and `remotes_changed` have no reliable key.
  A lease for observing a Filesystem was dropped as too complex.
- A removed Repository (2026-10-08): Machine A removes a Repository while B registers a Clone in it; after Sync, the Clone points to a deleted Repository.
  The last write per row cannot resolve it; the user thinks it very unlikely, so fix it in the merge rules only if easy (revive the Repository, or flag the Clone).
- The Links of Sync as a [transition function](development.md#transition-functions).
- `scripts/worktree_gui.sh` instances copy the real database and keep the identity of this Machine, so the script must turn Sync off and drop the Peers in the copy.
- Work in progress across Machines (user, 2026-10-20): `git stash create`, carried under a private ref and applied on the other Machine, as an explicit action.

## Mounts

`setup` registers only the Filesystem at `/`, and no command adds Filesystems or Mounts, so every path counts as local (2026-10-08).
With Sync, a shared NFS home must be one Filesystem seen by several Machines: commands that add and list Mounts, or detection from `/proc/self/mountinfo`, or both, and Filesystems matched across Machines.
Then the Machines View, with Mounts in the details of a Machine and a Filesystems View only for shared ones, and **Mount** in the glossary: "where a Machine sees a Filesystem, at a path".

## Setting up other Machines

- Wheels that include the built GUI (hatchling `force-include`), installed on other Machines.
- The later parts of `setup`: hooks, and setting up another Machine (from the ADRs).

## In the GUI

- A Machine column in Repositories (as in Events), with the chassis icons that the subjects of Events have.
- Paths on other Machines as SSH targets (`gaia:~/…`), and short host names.
- The logs of other Machines as `log?machine=…`.
- Staleness per View or per row (see [live updates](gui.md#live-updates)).

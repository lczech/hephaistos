# 001: Data ownership and sync

Status: accepted (2026-10-02), revised 2026-10-04: fully distributed instead of a central aggregating service.

## Context

Data comes from several Machines that may be offline or asleep. Each Machine must stay usable on its own, and no Machine should be required for another to work. A phone and morning summaries need an always-reachable Machine that saw everything.

## Decision

Every Machine keeps a full local copy of all data in its own database. The GUI only ever reads the local database. Data is split by who writes it:

| Data | Written by | Sync rule |
|---|---|---|
| State: Checkouts' git status, Worktrees, Terminals, Agents | only its own Machine | newest snapshot wins |
| Events: Agent started / waiting for input / ended / failed, Terminal created / closed, Clone added, Worktree added / removed, Branch switched | only the Machine where they occurred; immutable | union |
| Registry: Repositories, their Clones, Clusters, Links, inbox read position, settings | any Machine | last write wins, per record |

- Peers exchange everything they hold, so data spreads through whichever Machines are connected (e.g. laptop ↔ always-on Machine ↔ Cluster). Which Machines sync with each other is declared as [Links](../glossary.md) in the Registry.
- Each Machine's Sync exchanges with its Peers in both directions: on a timer (pull), and shortly after local changes (push). High-priority Events (e.g. Agent waiting for input) are pushed and forwarded right away; others wait for the next exchange. Machines that can't be reached from outside (laptops) open the connection themselves and keep it open while online, so they also receive pushes. Typical Peer layout, a star:
  ```
  laptops ── always-on Machine ── cluster login node
  ```
- The always-on Machine is not special in code; it is just always reachable, so it sees everything overnight and serves the phone.
- Data from other Machines is shown with when it was last seen. Live actions on a remote Machine (attaching a Terminal, launching) go directly to that Machine over SSH.

## Event sources

Not exhaustive; for example:
- **State changes**, found by comparing successive State snapshots: Branch switched, Terminal closed. These catch changes made outside our app.
- **Our own actions**: Clone added, editor opened (although that might be too much to track every time - probably not needed).
- **Pushed by Provider hooks**: Agent waiting for input, turn finished. These are moments a poll would miss.

Changes can be captured by polling as the baseline, and pushed where that is cheap and non-intrusive (e.g. hooks of our own tmux socket, file watches on local disks).

## Consequences

Needed from the start:
- globally unique IDs for every entity and Event;
- Events persisted durably and append-only, each with its origin Machine and a hybrid-clock timestamp (see [003](003-core.md)). Peers exchange "I have everything from Machine X up to time t" and send only what is missing;
- Registry records carry their last-modified time and Machine. Deletions are kept as markers, so a Peer cannot resurrect a deleted record. Each change also records an Event with the new values, which gives every record its history (reverting is a new edit);
- Registry, State and Events in separate tables;
- version numbers for the database schema and for the sync exchange, so Peers running different versions notice and handle it.

Deferred: sync transport details.

Trust (later): Registry changes that make a Machine execute something (Links, Automations) could otherwise travel through Sync against the direction of SSH access. They should be signed with per-Machine keys and accepted only from trusted Machines.

Size: only metadata is copied, never transcripts or Repositories. If needed later: prune or compact old Events, and partial copies per Peer connection (e.g. a cluster node sends its own data but receives only the Registry).

## Rejected

- **A central aggregating service that owns the Registry:** a single point that others depend on, and the special role adds code paths for no real gain.
- **Everything central, with thin per-Machine processes:** Machines would be unusable when the central one is unreachable.

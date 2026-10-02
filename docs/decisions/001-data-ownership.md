# 001: Data ownership

Status: accepted (2026-10-02)

## Context

Data comes from several machines that may be offline or asleep. Each machine must stay usable on its own, while a phone and morning summaries need one always-reachable place that saw everything.

## Decision

Data is split by who is authoritative for it:

| Data | Authoritative copy | Other copies |
|---|---|---|
| State: checkouts' git status, terminal sessions, agent sessions | that machine's service, read live from git, the terminal-session backend and transcripts | aggregating service: last-known, timestamped |
| Events: agent session started / waiting for input / ended / failed, terminal session created / closed, checkout added, branch switched | the machine where they occurred, append-only | aggregating service: collected copies |
| Registry: repositories, checkout assignments, clusters, inbox read position, settings | aggregating service | every service caches it |

- One always-on service also aggregates: it owns the registry, collects state and events from the others, and serves the web UI. The phone talks only to it; actions are forwarded to the target machine's service.
- If the aggregating service is unreachable, a machine shows its own live data plus cached data for everything else, labelled with when it was last seen. Registry changes made offline are queued and sent later.

## Merging

- Events are immutable, with a unique ID and an origin machine, so merging event logs means taking their union.
- Registry edits come from one user and are mostly additions, so last write wins.
- State is never merged: the newer reading replaces the older one.

## Consequences

Needed from the start:
- globally unique IDs for every entity and event;
- events persisted durably and append-only, with origin and timestamp;
- registry stored separately from state and events, even while one machine plays both roles.

Deferred: which machine aggregates, push vs pull, cache refresh.

## Rejected

- **Everything central, with thin services:** machines would be unusable when the aggregating service is unreachable.
- **Full replica on every machine:** this would need sync and conflict resolution, which is overkill for a single user.

# Ideas: how we build it

## Transition functions

Agreed 2026-11-08 as a suggestion to explore, not a decision.
Where a status changes from a stream of signals, write it as a pure transition function, `(previous, signal) → next`, over a discriminated union in TypeScript or a `match` in Python.
Side effects (timers, sockets, writes) stay outside and only feed signals in.
No XState, no Redux, and no store for the whole app: the snapshots and Events of [ADR 001](../decisions/001-data-ownership.md) stay as they are, TanStack Query holds the answers of the Server, and dockview holds the Layout.
Adopted per feature, with nothing to migrate.
The rules sit in one place that tests can reach, and recorded signals can be replayed, while State stays observed rather than folded from Events.
Candidates, in order: Agent attention ([Agents](agents.md#attention)), the attach stream of the Terminal View, the Links of Sync ([machines](machines.md#sync)).
Say "transition function", and call what it moves between a status or an attention state, never "state machine" ([glossary](../glossary.md#avoid)).

## The installation of the user

A separate live Worktree on master as the source of the installed tool, so that the Daemon of the user does not run work in progress.

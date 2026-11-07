# Watcher

How the Watcher runs the Core's observation in passes ([ADR 002](../../decisions/002-technology-stack.md)).
What a pass does: [observation](../core/observation.md).

## Passes

The Watcher passes at start, then `watcher.interval` seconds (60) after each pass ends, and when the Server asks (`POST /api/observe`).
With interval 0, it passes only when asked.
Passes never overlap.
A request waits for a pass that starts after it arrives, so that the pass sees what the user just did.
Requests arriving during a pass share the next one.
Each pass observes the Clones, then the Terminals; one logs how many of each.

## The worker

Passes run in a worker process, so that git never competes with interactive work and the Daemon's other parts keep their priority.
The worker lowers its own CPU and I/O priority once, before starting threads, so its threads and git inherit it: nice 19, and `ionice -c2 -n7`.
It does not use the idle I/O class, which could starve a pass that a GUI waits for.
The worker leads its own process group.
So Ctrl+C in a Terminal emulator does not reach it, and the Daemon stops it with its git in one signal.
A dead worker is replaced.

## Failures

A failed pass is logged, and the next one runs on schedule.
A pass that can't observe one part, e.g. Terminals with tmux not answering, observes the rest, and records the problem with the pass: `daemon status`, the status bar and the Status View show it until a pass without it ([Terminals](../core/terminals.md#observing)).
A busy database is retried 3 times, after 1, 2 and 4 s.

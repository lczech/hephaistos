# Logs

What hephaistos logs about itself, and how ([ADR 003](../decisions/003-core.md)).
`hephaistos log show` reads the log ([commands](../cli/commands.md#log)).

## Records

Logging uses the standard library's `logging`.
Each record is one line of JSON with:
- `at`, in UTC;
- `level`;
- `process`: `cli` or `daemon`;
- `pid`;
- `logger`;
- `message`;
- its extra fields;
- `error`, with a traceback.

Each record is one write in append mode, so processes writing at once need no lock.
Files are never rewritten.
The first record of a day deletes the files older than `log.retention_days` (30).

## Levels

- INFO: each run's start (its arguments) and end (outcome, duration), and each Event committed.
- WARNING: expected failures caught per unit, e.g. git failing for one Checkout, and transactions rolled back.
- ERROR: unexpected exceptions, with their traceback.
- DEBUG: git calls, transactions, fallbacks taken, and each Checkout observed.

Records never hold git's output, payloads or file contents.

`log.level` sets the level (default `info`).
`--debug`, anywhere in a command, logs that run at DEBUG and also shows its records on stderr.

## Failures

Failures are caught per unit of work, logged, and the rest goes on.
A unit is a Checkout; later also a sync or a request.
A run logs any other failure and ends; the CLI then prints `error: unexpected …` and where the details are.
Exceptions that end a thread are logged too.
Logging is best effort: if the file can't be written, the command warns and goes on.

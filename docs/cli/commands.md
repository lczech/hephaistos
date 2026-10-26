# Commands

The CLI's commands, how they address entities, and what they print ([ADR 003](../decisions/003-core.md)).

## Commands

```
hephaistos setup
hephaistos machine list | show
hephaistos repo list | show <name> | register <name> | rename <name> <new name>
                | unregister <name> [--clones] [--yes]
hephaistos clone register [path] [--repo <name>] [--import-history]
hephaistos clone list [--repo <name>] [--refresh] | show [--refresh] | unregister
                 | move <old> <new> [--nested]
hephaistos worktree list [--repo <name>] [--refresh] | show [path|name] [--refresh]
hephaistos event list [--kind <kind>] [--priority <min>] [--machine <name>] [--since <when>]
                     [--repo <name>] [--clone <path>] [--worktree <path|name>] [--reverse]
                     | show <id> | kinds
hephaistos observe [clones] [--clone <path>]…
hephaistos scan [dir] [--depth <n>] [-v] [--yes] [--import-history]
hephaistos db tables | dump <table> [-c <column>]… [--offset <n>] [--reverse] [--table|--blocks]
                                        [--short-ids]
hephaistos log show [--since <when>] [--until <when>] [--level <min>] [--process cli|daemon]
                    [--pid <pid>] [-n <count>] [--reverse] [--follow] [--brief] [--json] [--no-pager]
               | prune [--keep <days>d] [--yes]
hephaistos config show [<key>|<section>|--json] | defaults
hephaistos daemon run | status [--json] | token [--url] [--renew] [--yes]
                  | install [--linger] | uninstall | start | stop | restart
hephaistos [--debug] …
```

`setup`: [setup](../core/setup.md); `daemon`: [Daemon](../daemon/daemon.md) and, for `token`, [Server](../daemon/server.md#token).
Common options have one-letter short forms, e.g. `-r`, `-k` and `-n`.
Heavy imports happen only inside commands, to keep startup fast, e.g. for shell completion.

## Addressing

Entities are addressed by name.
Checkouts are addressed by path, `.` by default; that means the innermost Checkout containing the path, as git finds it.
Entities without a name are addressed by a short ID, the end of their UUID.
A path in a repository of its own inside a Checkout, nested or a submodule, is refused; git tells which repository a path is in.
Worktrees can also be addressed by name, asking which one if several Clones have one of that name.
`clone` commands accept a path in one of the Clone's Worktrees, except `clone unregister`.

## Output

Output is plain aligned text.
`--json` on `list` and `show` prints the same JSON as the Server's API.
Times are relative in lists (`now`, `3m`, `2h`, `5d`), full in `show` (`2026-10-05 14:03:21`), and ISO 8601 in JSON.
`--time-format auto|relative|short|full` and the setting `time_format` override this.
`short` is `14:03` today, `10-05 14:03` this year, and `2025-10-05` before.

## Asking

Asking happens between a read and a write session, so no write transaction waits for input.

## clone

`clone register` registers a Clone in the Repository it matches, by root commits and remotes.
Else it registers it in a Repository without Clones of the suggested name, as `scan` does, else in a new one of that name ([names](../core/data.md#names)).
`--repo` names the Repository; a missing one is created.
Each case asks in a terminal; without one, `--yes` takes it.
Matching several Repositories, it asks which in a terminal, and requires `--repo` without one.
A name taken by an unrelated Repository, or no name suggested, requires `--repo`.
It refuses:
- a Clone that shares no root commit with the Repository's other Clones; such Repositories don't count as matches either;
- a path inside a Worktree; the message names its Clone;
- a submodule; its superproject is the Clone.

`clone unregister` says when it leaves a Repository without Clones.

`clone move` records a move already made on disk; the Clone keeps its ID and history.
The old path must no longer be a repository, and the new one must share the Clone's history.
It refuses while links to its Worktrees are broken, as an observation would take them as removed; it prints the `git worktree repair` command.
With `--nested`, Clones inside it move along, all or nothing; without it, their commands are printed.

## repo

`repo unregister` refuses while the Repository has Clones.
`--clones` also unregisters them, on every Machine, after asking.
Files stay untouched.

## scan

`scan` registers the clones under a directory, `scan.depth` levels deep (3 by default), in one transaction.
It shows the plan first and asks once.
Each clone joins the Repository it matches, else a Repository without Clones by name, else a new one.
Clones found together match each other too.
A new Repository is named after the first of its clones' remotes that isn't a local path, else as `clone register` suggests.
A Worktree brings its Clone, wherever that is; a Worktree not observed yet has its Clone observed.
`scan` stops at clones without searching inside them, and skips hidden directories.
It follows symlinks, preferring real paths.
It refuses to start inside a Clone or at a submodule.
A clone that may be a missing Clone, moved, is skipped, with the commands for either case.
Nothing is guessed.
A clone matching several Repositories, or whose new Repository's name is taken, is skipped with the `clone register` command to register it by hand.

## event

`event list` shows the newest 20 (`--limit`), oldest first like `log show`; `--reverse` shows newest first.
Each comes with a summary of its payload.
`--repo` includes Events about its Clones and their Worktrees, and `--clone` those about its Worktrees.
`--kind` takes a kind, its leading parts (`clone`), or a glob (`'*.unregistered'`).
`--kind`, `--machine` and `--repo` repeat, for any of several.
`--since` takes a duration (`2h`) or a date.
`event kinds` lists the kinds this version records, with their priorities.

## log

`log show` shows the newest 50 records, oldest first, so the newest end next to the prompt, as in `journalctl`; `--reverse` shows newest first.
Times are local.
Tracebacks show below their record; `--brief` shows only their last line.
Extra fields show as `key=value`.
`--json` prints each record as stored, with its position: where its line starts, e.g. `2026-10-14:18734` for day file and byte.
A position stays the same while its file is only appended to.
`--follow` then waits for new records.
`log show` skips lines that aren't records, and says how many.
It pages like git: `$PAGER`, else `less` with `LESS=FRX`.
The log isn't an entity, so `show` shows all of it.

`log prune` deletes whole days, older than `--keep` (default `log.retention_days`), after asking.
`log` commands log only what goes wrong, so that showing the log doesn't add to it.
An unexpected error's message names `log show --pid`.

## config

`config show` shows each setting, its value, and where that comes from: `default`, a file, or a variable.
Then it shows each source in the order it applies: files by full path, as read, broken or not found.
It also shows other hosts' files, as unused here, and unknown `HEPHAISTOS_*` variables, naming the closest setting's.
Given a section, it shows that section's settings; given one setting, just its value.
A broken file or variable is left out and its error shown, and the command fails.
`config defaults` prints the shipped `defaults.toml`.

`--json` gives all of it, each setting also with:
- its type: `bool`, `int`, `float` or `text`;
- its description: the comment lines directly above it in `defaults.toml`;
- the value the process applies, which differs in the Daemon after an edit until it restarts.

Scripts take one value.

## db

`db` shows tables as stored, the newest rows, oldest first like `log show`.
`--reverse` shows newest first; `--offset` counts from the newest.
It also shows an outdated database, with a warning, and tables this version doesn't know.
Columns are decoded as their table's module declares ([data](../core/data.md#tables)).
Columns of unknown or outdated tables are decoded by name where all tables agree, else shown as stored.
All columns show one line per value; chosen columns (`-c`) show one line per row.
`--json` gives each column's name and type: `id`, `clock`, `time`, `json`, `hex` or `plain`, from its decoder, as its values are text there.
It puts warnings, e.g. an outdated schema, next to the rows; `--offset` pages.

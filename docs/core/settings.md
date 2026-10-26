# Settings

How settings are layered, checked and loaded ([ADR 003](../decisions/003-core.md)).
`hephaistos config show` shows them and where each comes from ([commands](../cli/commands.md#config)).

## Layers

Each layer overrides the ones before it, key by key:
1. `defaults.toml`, shipped in the package: every setting with its default and documentation.
2. Later: Registry settings, shared by all Machines and edited in the GUI.
3. `config.toml` in the config directory: for every Machine reading it, e.g. sharing a home directory.
4. `config.<hostname>.toml`: the first part of the hostname (`login1`), then all of it (`login1.hpc.example.org`).
5. Environment variables `HEPHAISTOS_<SECTION>_<KEY>`, e.g. `HEPHAISTOS_GIT_TIMEOUT`, for every setting; empty ones count as unset.
6. Command-line options, e.g. `--time-format`, and `--debug` for `log.level`.

Files hold how this Machine runs, e.g. timeouts, workers, Daemon parts and SSH targets.
Preferences shared by all Machines belong in the Registry layer, once it exists; until then `time_format` stays in the files.

## Format

TOML, with one or two levels of sections, named by topic.
`[gui]` holds what only the GUI uses; e.g. `[gui.diff]` holds the limits of its diffs, though the Server applies some of them.
Every setting has a real value, never null.
"Unset" behaviour gets a name (`time_format = "auto"`) or a natural number (0).
A missing key leaves the setting to the layer below.

## Checking

Settings are checked against typed sections (`Settings` in `config.py`), with limits.
Unknown keys, wrong types and wrong values fail, naming the file or variable and the key.
A broken config stops every command except `--help`, `--version`, `log`, `config` and `daemon`.
Those run on the defaults, with a warning; `daemon run` doesn't start.

## Loading

Each process loads its settings once, at startup (the CLI's `run()`, the Daemon), and activates them.
The Core reads them where it uses them, e.g. `config.settings().git.timeout`.
Changes apply to the next command, and to the Daemon after a restart.
The GUI reads what its Server's Daemon applies.

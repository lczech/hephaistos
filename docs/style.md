# Style

How we write: messages, `--help`, the GUI, docs, comments, docstrings and commit messages.
`tests/test_style.py` checks what a program can check: contractions.
Text that breaks a rule is fixed where we work on it.

## Terms

Terms are those of the [glossary](glossary.md).
In docs and code comments, defined terms are capitalised; in what users read, they are lowercase, except the name of a View where it names that View.
Docs have one sentence per line.

## Words

- No contractions: "is not", "cannot", "does not".
- Avoid possessives. For a fixed thing, use a compound noun: "the launcher entry", "the database schema". Otherwise, use "of" or "for": "the name of the Machine", "the systemd unit for the daemon".
- Always rewrite a possessive that stands in for a noun: not "this shell's", but "the directories of this shell".
- Prefer the precise word to the general one: "sets", not "has"; "other directories", not "elsewhere".

## Messages

A message that asks the user to act says what happened, then what to do: `error: <what happened>; <what to do>`.
A fragment is fine where it is clear and asks nothing of the user, as `permission denied`.

1. Give each verb its actor, and keep a phrase next to what it describes. Not "confirmation needed, but not run interactively", where "not run interactively" describes the confirmation, but "this command asks for confirmation only when run interactively".
2. Say what the program does, not what it declines to do. Not "not asking without a terminal", but the sentence above.
3. A remedy names the exact command or option, and what it then does: "add --yes to replace the systemd unit and restart the daemon without asking"; "hephaistos is not set up on this machine; run `hephaistos setup`".
4. A comparison names what is compared, and each side: not "the daemon has none, this shell /tmp/x", but "HEPHAISTOS_HOME: not set in the unit, /tmp/x in this shell".

To check a message, read each clause on its own, and ask who does what.

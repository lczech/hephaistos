# Ideas: Agents and attention

For the step of Agents and attention ([roadmap](../plans/roadmap.md)).

## Attention

- Attention as a [transition function](development.md#transition-functions) over the hooks of Providers (reported) and the exit or silence of a process (inferred).
  To settle: which signal wins (reported over inferred; by `occurred_at` or by the order of recording), that ended and failed are final, and when silence means unknown.
  Costly to change: whether Events carry enough to compute attention again, and whether attention is State written by its Machine or derived from Events by each viewer.
- Events that say how they were captured, and whether reported or inferred (from the ADRs).
- tmux `alert-bell` and `monitor-silence` as hints for attention.
- Hooks append to a JSONL inbox file rather than start Python ([ADR 002](../decisions/002-technology-stack.md)).

## Providers

- An Agents plugin that lists and drives the Agents of VS Code through its Agent Host Protocol (from the ADRs).
- Memory limits for Agents from the systemd scope of their Terminal (`MemoryMax`; see [Terminals](terminals.md)).

## From herdr (looked at 2026-11-08)

herdr (herdr.dev, github.com/herdrdev, Apache 2.0) runs terminals and coding agents; [Terminals](terminals.md#herdr-core-as-a-second-keeper) has herdr-core as a keeper.
Words in quotes are those of herdr, not ours.

**OSC 7501, the Program Status Protocol.**
A program in a terminal reports its own status by an escape sequence: working, done, blocked (needs the user) or error.
herdr-core stores what a program reports; it does not read the screen or know brands of agents, and a program that reports nothing has no status.
Open for us: tmux, our keeper, does not keep unknown OSC sequences; we would see them only in a control-mode stream, so detection while nobody watches would need the Daemon to hold one stream per Terminal.
Check then which Providers send it themselves (Claude Code, Codex): herdr lists OpenCode, Pi, Kimi, Kilo and a few others as reporting.

**Detection from the screen (herdr TUI).**
For 22 agent CLIs (Claude Code, Codex, Copilot, Cursor and others), herdr finds the process of the agent in a pane and matches the live bottom of the screen against rules per agent ("detection manifests": TOML, updated from herdr.dev, with local overrides).
"Blocked" is strict: only a known approval or question screen counts; otherwise it falls back to "idle", labelled as a fallback.
`herdr agent explain` shows which rule matched: an idea for our "unknown" attention state.
`herdr integration install <agent>` installs hooks that report the attention state and a resume command, so an agent continues where it was after a restart of the herdr server.

**For the design.**
- Attention states: working, blocked, done (finished while nobody looked), idle (done, then seen), unknown. Ours (AGENTS.md): working, waiting for input, ended, failed, unknown; "done until seen" fits the [inbox](inbox.md).
- Seen per client: viewing a finished Agent in one client does not clear the badge in another; the API uses what the herdr server has seen.
- Rollups: the attention state of a tab or a "space" is the most urgent of its agents: blocked, then done, then working, then idle.
- Helper agents: a terminal that an agent starts records that agent as its parent; children end with the parent unless told otherwise; they belong to the tab of the parent without a pane, and can be peeked at.
- Adoption by labels: a terminal started by hand with the labels `herdr.space=<id>` and `herdr.tab=<id>` shows up there (ours: `@hephaistos_id` on tmux sessions).
- Addresses: `t7` on this Machine, `vps/t7` on another.
- What herdr lacks: it sees only agents in its own terminals; nothing from editor extensions, no lasting history, no last-known information for unreachable Machines.

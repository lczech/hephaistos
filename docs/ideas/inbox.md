# Ideas: the inbox

For the step of the inbox ([roadmap](../plans/roadmap.md)).

- Configurable Event priorities (user, 2026-10-07), with overrides as in VS Code.
  Open: applied when recorded (by the origin Machine, synced) or when viewed (by each viewer), and whether in Registry settings rather than in files per Machine.
- Rewritten history (user, 2026-10-24: not important): Events are only appended, so after a rebase or `filter-branch`, old commit Events name commits that no branch has.
  Link them to their successors, inferred by patch ID; the mapping of git reaches only a `post-rewrite` hook, which we do not install.
- "Done until seen", per client: see [Agents](agents.md#from-herdr-looked-at-2026-11-08).
- Events for Terminals: see [Terminals](terminals.md#elsewhere).
- The tray: see [Desktop](desktop.md#the-tray).

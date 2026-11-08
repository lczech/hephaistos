# Ideas: Terminals

For the Terminals work and after it ([roadmap](../plans/roadmap.md)); its plan is in `docs/plans/` on the branch `terminals`.

## The Terminal View

- Detaching (closing the Panel) and killing both easy, e.g. a kill button next to close or in the bar of the Panel, with killing confirmed.
- Ctrl+W: the GUI closes Panels with it, but shells delete a word with it. The user leans to Ctrl+W closing the Panel, as in every other Panel, undecided (GNOME Terminal uses Ctrl+Shift+W).
- Find in Terminals: see [Views](views.md#find).

## From tmux

The user wants these (2026-11-05):

- Memory and CPU per Terminal from its own systemd scope, shown in the GUI; limits (`MemoryMax`) for Agents. The user is keen: offer it at the end of the Terminals work.
- Images in Terminals: `allow-passthrough`, and `@xterm/addon-image` for Sixel and the iTerm2 protocol. tmux keeps no images in its history, so they are gone after attaching again.
- History kept across reboots, by `pipe-pane` or by `capture-pane` snapshots now and then, with limits on size and rotation.
- `alert-bell` and `monitor-silence` as hints for attention, with [Agents](agents.md).
- Shell integration (OSC 133) for the commands run inside shells.

## Elsewhere

- "Terminal here" in the Explorer (user, 2026-11-06): a row action that opens a Terminal View at the folder, not an external Terminal emulator; once Terminals merge.
- Events for Terminals: none for now (created, closed, ended, lost); add them with the [inbox](inbox.md) if needed.

## herdr-core as a second keeper

Not for now; raise it at the end of the Terminals work, or if tmux falls short (2026-11-08).
It would revisit the decision that the keeper has one implementation, is not a plugin, and has no setting to choose it.
herdr-core (`hc`, Rust, Apache 2.0, github.com/herdrdev/herdr-core) is a terminal runtime for agents, comparable to tmux as our keeper.
It offers: terminals that outlive their viewers and `hc update`; `run --bg --name --cwd --keep`, `ls`, `attach`, `read --lines`, `send`, `wait`, `get`, `events`; labels on terminals; parent and child links between an agent and the helpers it starts; a status from OSC 7501 ([Agents](agents.md#from-herdr-looked-at-2026-11-08)); an OpenRPC API (`hc schema`) with event streams, also over stdin and stdout through SSH (`hc connect`); other Machines (`hc machine add`, which copies `hc` there).
As with tmux, a reboot ends its programs (`--keep` gives a fresh shell in the same folder).
Costs: one more binary on every Machine, clusters included; a young API; the tmux control-mode work would become one of two backends.

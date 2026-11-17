# Ideas: Terminals

For the Terminals work and after it ([roadmap](../plans/roadmap.md)).
Terminals in the Core and the CLI are done ([terminals](../design/core/terminals.md)); what follows is for the steps after them.

## Next: the stream and the View

The aim: a Terminal View, a terminal in a Panel that feels like a plain terminal emulator, e.g. GNOME Terminal, with its own scrolling, selection, mouse, keys and colours, and no sign of tmux.
Closing the Panel, the GUI or the Daemon leaves the Terminal running.
The CLI attaches with plain tmux, which shows that it is tmux.

- The stream in the Server: one control-mode client per open Terminal View, over a WebSocket; the parser of control mode passes what it does not know, and says so once.
  To find out with tests: whether tmux and xterm.js both answer the queries of a program, e.g. which terminal it is in.
- The Terminal View (xterm.js): a Panel whose Terminal ended or was lost says so, with actions.
  Ctrl+D closes an ended one, as attached from the CLI: control mode runs no key bindings, so the View does it.
  To test: keys (e.g. Home, End) and colours reach programs as xterm.js sends them; a pane whose size another client sets (`window-size latest`, e.g. the CLI attached too) still shows well in its Panel.
- Then Terminals on other Machines.

## The Terminal View

- Detaching (closing the Panel) and killing both easy, e.g. a kill button next to close or in the bar of the Panel, with killing confirmed.
- Ctrl+W: the GUI closes Panels with it, but shells delete a word with it. The user leans to Ctrl+W closing the Panel, as in every other Panel, undecided (GNOME Terminal uses Ctrl+Shift+W).
- Find in Terminals: see [Views](views.md#find).
- Restarting an ended command Terminal: its command again, in its directory, with its name (user, 2026-11-13: later, as an action of the View, maybe also `terminal restart`).

## From tmux

The user wants these (2026-11-05):

- Memory and CPU per Terminal from its own systemd scope, shown in the GUI; limits (`MemoryMax`) for Agents. The user is keen: offer it at the end of the Terminals work.
- Images in Terminals: `allow-passthrough`, and `@xterm/addon-image` for Sixel and the iTerm2 protocol. tmux keeps no images in its history, so they are gone after attaching again.
- History kept across reboots, by `pipe-pane` or by `capture-pane` snapshots now and then, with limits on size and rotation.
  At least the last screen of an ended Terminal, which no longer changes, saved once as it ends: now a reboot loses it, and its row only says how it ended (2026-11-13).
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

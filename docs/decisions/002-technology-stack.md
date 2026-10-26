# 002: Technology stack and components

Status: accepted (2026-10-04)

## Context

Ubuntu comes first; a phone interface is secondary and comes later. The GUI should get embedded Terminals, a small editor and VS Code-like dockable panels. Our code must also run on cluster login nodes, without root.

This ADR records the decisions that are costly to change.
How the parts work is described per part: [docs/core/](../core/), [docs/daemon/](../daemon/), [docs/cli/](../cli/commands.md), [docs/desktop/](../desktop/desktop.md) and [docs/gui/](../gui/); tools and tests in [development](../development.md).

## Components

Code is separated by purpose; the number of processes is a deployment choice.

| Directory | What it is |
|---|---|
| `core/` | The Core library: domain model, operations, storage, git, and the interfaces that plugins implement. All logic lives here, including observing a Machine (taking State snapshots, comparing them into Events, reading the hook inbox) and the sync merge rules. |
| `cli/` | The CLI, command `hephaistos`. Works directly on the local database via the Core; needs no running Daemon. |
| `daemon/` | The Daemon, command `hephaistos daemon run`: reads this Machine's config and runs the enabled parts below. |
| `daemon/watcher/` | The Watcher: runs the Core's observation of this Machine in passes, one at a time, at low CPU and I/O priority. |
| `daemon/sync/` | Sync: talks to Peers and decides when; merging is done by the Core (see [001](001-data-ownership.md)). |
| `daemon/server/` | The Server: HTTP/WebSocket access to the Core for GUIs, and serves the `gui/web/` files to browsers; see [004](004-server.md). |
| `desktop/` | Starting the Desktop from the checkout, and what it needs on this Machine (an AppArmor profile); the CLI's `desktop` commands. |
| `plugins/` | Everything tool-specific, grouped by extension point; see below. |
| `gui/web/` | The GUI itself: one React app, used by both Electron and the phone's browser. |
| `gui/desktop/` | The Desktop, `hephaistos desktop open`: Electron's main process around `gui/web/` (window, keyboard shortcuts). |
| `assets/` | The icon (`icon.svg`) and the logo with the name, used by the README, the GUI and the Desktop. |

Dependencies only point towards the Core. The Core knows none of the other parts; `gui/` never imports Python and only speaks HTTP to the Server.

```
cli ──────────────────────┐
daemon ─> watcher ────────┤
       ─> sync ───────────┼──> core
       ─> server ─────────┤
plugins ──────────────────┘
gui/desktop ─> gui/web ──HTTP──> server
```

- **Daemon:** one background process per Machine runs whichever of Watcher, Sync and Server that Machine's config enables, as asyncio tasks; a crashing part is restarted without affecting the others. One command for CLI and Daemon keeps a single thing on the PATH. Each part can also run alone. On desktops it runs as a systemd user unit; elsewhere in a tmux session, which the app can start over SSH. Machines without a running Daemon are reached by Peers over SSH, running the Daemon in one-shot mode: one Watcher pass, then a sync exchange over that connection.
- **Process ownership:** no component owns managed work (Terminals and the Agents in them); keeping them alive is the job of the terminals plugin (e.g. tmux). Electron only does desktop integration; logic stays in the Core.
- **Concurrency:** CLI, Daemon and hooks write the same SQLite database independently. WAL mode lets reads never wait for writes; on a network filesystem, where WAL doesn't work, a rollback journal takes its place ([setup](../core/setup.md#database-file)). Hooks append to a JSONL inbox file instead of starting Python, to stay fast.

## Plugins

Everything tool-specific is a plugin, our built-in ones included. Only git stays in the Core, because its model is part of our domain. Plugins are grouped by extension point:

```
plugins/
  agents/      claude-code/, codex/
  terminals/   tmux/
  launchers/   vscode/, gnome-terminal/, terminator/, xdg-open/
```

Extension points are named after what their plugins supply: `agents/` support kinds of Agents (one per Provider), `terminals/` keep Terminals alive, and `launchers/` open things (directories, files, Terminals, URLs) in tools such as editors, file managers or Terminal emulators.

- The Core defines one small interface per extension point and discovers plugins through Python entry points; it never imports them. Built-in plugins register the same way an external one would.
- Plugins depend only on the Core.

## Interacting with Agents

In the GUI, first through the embedded Terminal panel attached to the Agent's Terminal; then approving permission requests via Provider hooks (also from the phone); possibly later a chat panel, driven through the agents plugin interface.

## Technologies

- **Python** for everything except `gui/`, packaged with a standard `pyproject.toml` (installs with pip, pipx, conda or uv; uv is recommended). FastAPI for HTTP and WebSocket; SQLite via the standard library, with plain SQL.
- **GUI:** TypeScript, Vite and React; dockview for panels, xterm.js as embedded Terminal emulator, Monaco for quick edits. VS Code is launched as a separate app, not embedded.
- **GUI tooling:** Node as a development dependency of the Python project (`nodejs-wheel`), so nothing is installed outside it. npm, TypeScript (strict), Biome, Vitest. TanStack Query and openapi-fetch, with types generated from the API's schema. CSS modules and one theme file, no component library so far. React's compiler, strictly, instead of memoizing by hand. Details: [development](../development.md#gui).
- **Desktop shell:** Electron, so the app receives all keyboard shortcuts (e.g. Ctrl+W in a Terminal) instead of the browser taking them. It loads the GUI from this Machine's Server, as a browser would, never a copy of its own, so the Server's checks apply unchanged ([004](004-server.md)). How it works: [Desktop](../desktop/desktop.md).
- **Transport:** HTTP/JSON and WebSocket, always authenticated. Machines reach each other through SSH. Connectivity (Tailscale, VPN, jump hosts) is set up in SSH and the network, not in our code; Peers only need SSH in one direction.
- **Terminals:** tmux on its own socket (`tmux -L hephaistos`) with our own config (e.g. no status bar), kept separate from the user's tmux. The backend stays swappable (e.g. for shpool).
- **Polling:** in the background at a configurable interval (default 60 s), plus immediately when the GUI gains focus, through each connected Machine's Server. A GUI reads what it shows from the API's listings, never from the answer to its request, so that it also sees what other passes, the CLI and Sync changed; it asks again when the Server hints at a change ([004](004-server.md)). Agent Events are pushed by Provider hooks instead of being polled.
- **Testing:** pytest for the Core, with fake plugins standing in for real tools; Vitest and Testing Library for the GUI, in jsdom; real browsers (Playwright) for what only a browser lays out. GUI tests reach no Server. Details: [development](../development.md#tests).
- **Settings:** Machine-specific settings live in local TOML files, with a file per host where a home directory is shared ([settings](../core/settings.md)). Cross-Machine settings will live in the Registry. Edited in files first, in the GUI later.

## Rejected

- **Native GUI (Qt, GTK):** Qt's embedded terminal is weaker, GTK's docking is weaker, and neither offers a path to the phone.
- **Tauri:** on Linux it uses WebKitGTK, which handles xterm.js less well than the Chromium that Electron ships.
- **Go or Rust:** easier single-binary deployment, but less familiar. Python with uv covers cluster deployment well enough.
- **Plain browser or installed web app:** the browser keeps shortcuts like Ctrl+W for itself.
- **CLI as a client of a running Daemon:** the CLI would stop working whenever the Daemon is down.

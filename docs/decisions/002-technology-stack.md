# 002: Technology stack and components

Status: accepted (2026-10-04)

## Context

Ubuntu comes first; a phone interface is secondary and comes later. The GUI should get embedded Terminals, a small editor and VS Code-like dockable panels. Our code must also run on cluster login nodes, without root.

## Components

Code is separated by purpose; the number of processes is a deployment choice.

| Directory | What it is |
|---|---|
| `core/` | The Core library: domain model, operations, storage, git, and the interfaces that plugins implement. All logic lives here, including observing a Machine (taking State snapshots, comparing them into Events, reading the hook inbox) and the sync merge rules. |
| `cli/` | The CLI, command `hephaistos`. Works directly on the local database via the Core; needs no running Daemon. |
| `daemon/` | The Daemon, command `hephaistos daemon run`: reads this Machine's config and runs the enabled parts below. |
| `daemon/watcher/` | The Watcher: runs the Core's observation of this Machine in passes, on its timer and when a GUI asks, one at a time, in a worker process at low CPU and I/O priority (`nice`, `ionice -c2 -n7`), so that git never competes with interactive work and the other parts keep their priority. |
| `daemon/sync/` | Sync: talks to Peers and decides when; merging is done by the Core (see [001](001-data-ownership.md)). |
| `daemon/server/` | The Server: HTTP/WebSocket access to the Core for GUIs, and serves the `gui/web/` files to browsers; see [004](004-server.md). |
| `desktop/` | Starting the Desktop from the checkout, and what it needs on this Machine (an AppArmor profile); the CLI's `desktop` commands. |
| `plugins/` | Everything tool-specific, grouped by extension point; see below. |
| `gui/web/` | The GUI itself: one React app, used by both Electron and the phone's browser. |
| `gui/desktop/` | The Desktop, `hephaistos desktop open`: Electron's main process around `gui/web/` (window, keyboard shortcuts; later tray icon and notifications). `gui/package.json` is one npm package for both, and Electron's app. |
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
- **Concurrency:** CLI, Daemon and hooks write the same SQLite database independently (WAL mode, so reads never wait for writes). The database must be on a local disk, since SQLite locking is unreliable on network filesystems. Hooks append to a JSONL inbox file instead of starting Python, to stay fast.

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
- Later: GUI panel types as plugins, in TypeScript.
- Later, possibly: an agents plugin that lists and drives VS Code's agents via its Agent Host Protocol.

## Interacting with Agents

In the GUI, first through the embedded Terminal panel attached to the Agent's Terminal; then approving permission requests via Provider hooks (also from the phone); possibly later a chat panel, driven through the agents plugin interface.

## Technologies

- **Python** for everything except `gui/`, packaged with a standard `pyproject.toml` (installs with pip, pipx, conda or uv; uv is recommended). FastAPI for HTTP and WebSocket; SQLite via the standard library, with plain SQL.
- **GUI:** TypeScript, Vite and React; dockview for panels, xterm.js as embedded Terminal emulator, Monaco for quick edits. VS Code is launched as a separate app, not embedded.
- **GUI tooling:** Node comes as a development dependency of the Python project (`nodejs-wheel`), so nothing is installed outside it; npm, TypeScript strict, Biome for linting and formatting, Vitest for tests. TanStack Query fetches and refreshes data, through openapi-fetch with types generated from the API's schema (`gui/web/openapi.json`, recorded by the API's schema test). Styles are CSS modules plus one theme file of named values, without a component library so far. Vite builds into `gui/web/dist/` (not in git), which the Server serves; the wheel will carry it once Machines install from one.
- **Desktop shell:** Electron, so the app receives all keyboard shortcuts (e.g. Ctrl+W in a Terminal) instead of the browser taking them. It loads the GUI from this Machine's Server through `hephaistos daemon token --url`, as a browser would, never a copy of its own, so that the token, the Content-Security-Policy and the Server's checks apply unchanged ([004](004-server.md)). When the Server can't be reached, it starts the installed Daemon through systemd, saying why meanwhile; it follows a renewed token by watching its file. The page stays on the Server (other web pages open in the browser), gets no Node, and is refused permission requests; the window keeps only reload, zoom, full screen, developer tools and quit as its keys. One Desktop runs per HEPHAISTOS_HOME, its profile in the state directory. `desktop install` writes its launcher entry and icon, named as Electron's app ID so that the dock shows them for its window. Ubuntu lets only programs with an AppArmor profile use Chromium's sandbox: `desktop install` also writes one for Electron's binary and, if the user agrees, installs it with `sudo -k`.
- **Transport:** HTTP/JSON and WebSocket, always authenticated. Machines reach each other through SSH. Connectivity (Tailscale, VPN, jump hosts) is set up in SSH and the network, not in our code; Peers only need SSH in one direction.
- **Terminals:** tmux on its own socket (`tmux -L hephaistos`) with our own config (e.g. no status bar), kept separate from the user's tmux. The backend stays swappable (e.g. for shpool).
- **Polling:** in the background at a configurable interval (default 60 s), plus immediately when the GUI gains focus, through each connected Machine's Server. A GUI reads what it shows from the API's listings, never from the answer to its request, so that it also sees what other passes, the CLI and Sync changed; it asks again when the Server hints at a change ([004](004-server.md)). Agent Events are pushed by Provider hooks instead of being polled.
- Later, for polling: a pass narrowed to some Clones (e.g. a refresh button on one), and inotify on Clones' `.git` (HEAD, index, refs, logs) to observe a changed Clone within a second, on local Filesystems; edits in a working tree and network Filesystems still need polling.
- **Testing:** pytest for the Core, with fake plugins standing in for real tools; Vitest and Testing Library for the GUI.
- **Settings:** Machine-specific settings live in a local TOML file, with sections per Machine where a home directory is shared. Cross-Machine settings live in the Registry. Edited via CLI or file first, in the GUI later.

## Rejected

- **Native GUI (Qt, GTK):** Qt's embedded terminal is weaker, GTK's docking is weaker, and neither offers a path to the phone.
- **Tauri:** on Linux it uses WebKitGTK, which handles xterm.js less well than the Chromium that Electron ships.
- **Go or Rust:** easier single-binary deployment, but less familiar. Python with uv covers cluster deployment well enough.
- **Plain browser or installed web app:** the browser keeps shortcuts like Ctrl+W for itself.
- **CLI as a client of a running Daemon:** the CLI would stop working whenever the Daemon is down.

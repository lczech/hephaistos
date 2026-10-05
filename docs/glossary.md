# Glossary

The domain terms used in code, GUI and docs. Use the preferred term and avoid the listed alternatives.
The only tool named here is git, because its model is part of our domain. Everything else is described by its role.

In docs, defined terms (Core terms, Components, Later) are capitalised, including plurals, to set them apart from everyday words. Supporting terms stay lowercase.

## Core terms

| Term | Definition |
|---|---|
| **Repository** (repo) | A logical git repository: the unit you register. It spans all its Checkouts on all Machines. |
| **Checkout** | A git working tree of one Repository, at a path on a Filesystem: a Clone or a Worktree. Umbrella term; there is no Checkout record of its own. |
| **Clone** | A Checkout that owns its `.git`. Registered by the user, so part of the Registry. |
| **Worktree** | A Checkout linked to a Clone via `git worktree`. Found by observing its Clone, so part of State; identified by its Clone and path while it exists. |
| **Branch** | A named line of commits, in the usual git sense. Each Clone has its own copies, which can diverge. Worktrees share their Clone's Branches. For now, a Branch is part of a Checkout's State: current Branch (or detached HEAD), ahead/behind its upstream, and whether the working tree is dirty. |
| **Machine** | A computer where processes run, with its own copy of our data. Each login node or free node of a Cluster is its own Machine. |
| **Filesystem** | A set of paths that resolve to the same files on every Machine that sees it. By default, each Machine has its own. A shared cluster filesystem is one Filesystem, seen by many Machines. |
| **Cluster** | A named set of Machines, used only for grouping and filtering in views. A Machine may belong to several Clusters. |
| **Link** | A declared sync connection: Machine A syncs with Machine B, reaching it via SSH target T. Directed: A opens the connection. Part of the Registry; its State (written by A) records the last attempt, last success and last error. All Machines and Links form the network. |
| **Terminal** | A persistent shell on a Machine, with a stable ID. It survives closing the Terminal emulator that shows it. Kept alive by a terminals plugin (currently tmux). |
| **Terminal emulator** | A program that displays a Terminal: an external app (e.g. GNOME Terminal, opened via a Launcher) or our embedded panel. Always written in full. |
| **Provider** | Agent software, e.g. Claude Code or Codex. |
| **Agent** | One instance of a Provider with its own conversation, ID and transcript. Attributes: Provider, Machine, working directory, front end (Terminal or editor extension), the Terminal it runs in (if any). It outlives its process (the transcript stays on disk and can be resumed). Attention state: working / waiting for input / ended / failed / unknown, marked as reported or inferred. |
| **Launcher** | A way to open something (directory, files, Terminal, URL) in a tool on a Machine, in its graphical session. Categories: editor, file manager, Terminal emulator. |
| **Event** | A timestamped fact about any entity. It records its origin Machine, how it was captured (Watcher, our own action, Provider hook), and whether it is reported or inferred. The inbox and summaries are views built from Events, not entities. |
| **State** | What is currently true on a Machine: Checkouts' git status, Worktrees, Terminals, Agents. Observed by that Machine's Watcher (or a CLI run); a newer reading replaces the older one. Qualify other uses ("attention state"). |
| **Registry** | The user's declarations that no Machine can derive: Repositories, their Clones, Clusters, Links, inbox read position, settings. Any Machine may change it; synced between Peers. See [data ownership](decisions/001-data-ownership.md). |

## Components

Our own software parts; see [technology stack](decisions/002-technology-stack.md).

- **Core**: the library holding all logic. Not a process.
- **CLI**: the command-line client, `hephaistos`.
- **Daemon**: the background process on a Machine, `hephaistos-daemon`. It runs the parts enabled there, or a single pass of them (one-shot mode):
  - **Watcher**: observes this Machine and records State and Events.
  - **Sync**: exchanges data with Peers.
  - **Server**: HTTP/WebSocket access for GUIs; also serves the GUI files.
- **GUI**: the React app; **Desktop**: the Electron shell around it, `hephaistos-gui`.
- **Peer**: the Machine at the other end of a Link.

## Supporting terms

Vocabulary used consistently, but not stored as entities.

- **Directory**: any directory on a Filesystem. A Checkout is a directory.
- **Working directory**: the directory a process (Terminal, Agent) runs in. It may lie inside a Checkout.
- **View**: a page or component of the GUI showing entities, e.g. the Repository table.
- **Panel**: a dockable area of the GUI that shows a view or a Terminal.

## Later

- **Project**: a possible grouping of several Repositories (e.g. code, paper, analysis).
- **Workspace**: a saved working arrangement, probably spanning several Checkouts.
- **Scheduler**: a job system such as SLURM. Machines can submit to it.
- **Job**: work submitted to a Scheduler. It runs on Machines the Scheduler chooses.
- **Automation**: a saved prompt with a Provider, a target (Machine, plus a Checkout, a new Worktree or no directory) and a trigger (time-based, later also Events). Each run is an Agent, interactive in a Terminal or headless. Part of the Registry; run by the target Machine's Daemon.

## Relationships

```
Repository 1──* Clone 1──* Worktree          (both are Checkouts)
Checkout *──1 Filesystem *──* Machine *──* Cluster
Machine 1──* Terminal ──(working directory)──> Directory
Machine 1──* Agent ──(working directory)──> Directory
Provider 1──* Agent *──0..1 Terminal (runs in)
Machine 1──* Link *──1 Machine (syncs with)
Event ──> any entity
```

## Identity

Every entity and Event has a stable, globally unique ID assigned by us. IDs never rely on git hashes, paths, hostnames, window titles or PIDs alone.

A Machine gets its ID when our software first runs there; its hostname only helps to recognise it.

Adding a Clone to a Repository:
- The Core reads the Clone's root commits and remote URLs. A match with an existing Repository is a *suggestion* that the user confirms. With no match (or no commits yet), the user picks a Repository or creates one.
- Worktrees belong to their Clone's Repository (`git rev-parse --git-common-dir`) and appear by observing the Clone.
- Clones created by the app are assigned directly.
- Forks share root commits and therefore match as the same Repository unless the user splits them.

## Avoid

| Avoid | Use |
|---|---|
| computer, host, system | Machine (hostname is only an attribute) |
| server (for machines) | Machine. "Server" means only our Server component |
| service (for our processes) | Daemon, or the specific part (Watcher, Sync, Server) |
| aggregator, collector, hub | Sync; "always-on Machine" for its role |
| remote / local as types | Machine. Use remote/local only as relative adjectives |
| project (for now) | Repository |
| bare "state" for attributes | qualified, e.g. attention state (bare State is the data category) |
| bare "session" | Terminal or Agent ("session" stays free for later, e.g. GUI sessions) |
| terminal session | Terminal |
| terminal (for the app showing it), emulator | Terminal emulator |
| agent session, conversation, chat, thread | Agent (a Provider's "session ID" is the Agent's provider ID) |
| agent (for the software) | Provider |
| node | Machine (except "login node"/"compute node" in cluster context) |
| storage, volume, disk | Filesystem |
| connection (for the declared record) | Link. "Connection" means the live network connection |
| routine, scheduled task, cron job | Automation ("schedule" only for its time-based trigger) |
| tool names (VS Code, tmux, SLURM, …) | Provider, Terminal, Launcher category, Scheduler, … (git excepted) |

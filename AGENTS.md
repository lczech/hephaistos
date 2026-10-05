Help me design and start building a personal application for managing repositories, checkouts, machines, terminals and agents.

Use the terms defined in [docs/glossary.md](docs/glossary.md) consistently in code, GUI and docs; in docs, defined terms are capitalised.

**Context and problem**

I use Ubuntu and VS Code on my laptop. I also have an always-on remote machine, accessed over SSH, where I want agents and other tasks to run unattended, including overnight. Furthermore, I have access to several computer clusters, via VPN and SSH, on which I want to run work via SLURM.

Starting work currently involves manually opening an editor, terminals in the checkout, and a file manager. I also need to find existing agents and running terminals again, and later on also scheduler jobs. A repository may have independent clones on several machines (laptop, remote machine, clusters), plus several git worktrees for parallel tasks.

I want one extensible GUI that helps me launch, resume, and oversee this work.

**Desired experience**

Eventually, the application should provide:

- Views by repository and by machine.
- A launcher for editor, terminals, and file manager at the correct checkout.
- An overview of running and detached terminals and agents, with reconnect actions.
- Agent attention indicators: working, waiting for input, ended, failed, or unknown.
- A persistent “since you last checked” inbox and morning summary.
- Branch and working-tree status for each checkout.
- Embedded terminal tabs, followed by file browsing, previews, and possibly editing.
- An Android-accessible interface for checking progress and interacting with remote terminals and agents.

Build this incrementally. The first version should be useful without becoming a complete IDE.

**Architecture**

Decided in [docs/decisions/](docs/decisions/):

- [001 Data ownership and sync](docs/decisions/001-data-ownership.md): every Machine keeps a full copy of all data and syncs with its Peers; each Machine alone writes its own State and Events. An always-on Machine is special only in being reachable (overnight collection, phone access).
- [002 Technology stack and components](docs/decisions/002-technology-stack.md): Python Core library with CLI and a per-Machine Daemon (Watcher, Sync, Server); TypeScript/React GUI with dockview panels, xterm.js and Monaco; Electron desktop shell; SQLite; tmux keeping Terminals alive; plugins for Agents, Terminals and Launchers.
- [003 Core foundations](docs/decisions/003-core.md): package layout, setup, conventions (UUIDv7, hybrid logical clock), first tables, observers and the first CLI.

Keep interfaces and process ownership separate: closing or crashing the GUI must not terminate managed work. Each Machine should remain usable when other Machines are unreachable. Disconnected Machines should show timestamped last-known information.

Desktop actions must execute on the intended Machine and, where necessary, in its graphical user session. A web interface can request these through the authenticated Server on that Machine; it cannot directly launch arbitrary desktop applications by itself.

**Domain model**

Defined in [docs/glossary.md](docs/glossary.md). In short: a **Repository** (registered, git required) has **Checkouts** (clones or worktrees) on **Filesystems** seen by **Machines**; Machines run our **Daemon**, **Terminals** and **Agents**; **Events** record what happened.

A Terminal and an Agent are different things. Do not assume Agents from editor extensions and from the CLI are interchangeable or automatically discoverable. If possible, an overview should list _all_ Agents of all Providers (e.g. Claude Code, Codex), on any Machine, from the CLI or an editor.

**Reference project**

A colleague’s project contains useful ideas:
https://github.com/genomewalker/relay-terminal

Especially relevant are durable remote session identities, structured agent events, machine/workspace/session navigation, and its “since you last checked” inbox.

Its desktop app is macOS-only and uses a custom remote daemon. We want our own Ubuntu-compatible application. Use it as design inspiration; it currently states that no project license has been selected, so do not copy its implementation without appropriate permission. Several sister plugin repositories describe experimental or unreleased features.

**First milestone**

Aim for a small working vertical slice:

1. Register a repository and its local checkout.
2. Show the checkout in a repository overview.
3. Open it in the editor, an external terminal emulator, and the file manager.
4. Create or reconnect to a named terminal.
5. Reopen the application and recover the registered repositories and terminals.
6. Establish how the same core will support other machines later (sync, SSH + CLI).

Then add remote-machine support, agent events and attention, embedded terminals, and phone access in successive milestones.

**How to proceed**

First inspect the repository and available environment. Present a concise architecture recommendation, the important open decisions, and a staged implementation plan. Identify which choices are costly to change and which can wait.

Then begin the smallest useful implementation. Ask only about missing information that materially blocks progress, and make reasonable reversible choices otherwise. Keep explanations concise, document important decisions, and verify meaningful behaviour rather than producing a large scaffold or speculative abstractions.

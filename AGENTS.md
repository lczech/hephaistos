Help me design and start building a personal application for managing repositories, checkouts, machines, and terminal and agent sessions.

Use the terms defined in [docs/glossary.md](docs/glossary.md) consistently in code, UI and docs.

**Context and problem**

I use Ubuntu and VS Code on my laptop. I also have an always-on remote machine, accessed over SSH, where I want agents and other tasks to run unattended, including overnight. Furthermore, I have access to several computer clusters, via VPN and SSH, on which I want to run work via SLURM.

Starting work currently involves manually opening an editor, terminals in the checkout, and a file manager. I also need to find existing agent sessions and running terminal sessions again, and later on also scheduler jobs. A repository may have independent clones on several machines (laptop, remote machine, clusters), plus several git worktrees for parallel tasks.

I want one extensible GUI that helps me launch, resume, and oversee this work.

**Desired experience**

Eventually, the application should provide:

- Views by repository and by machine.
- A launcher for editor, terminals, and file manager at the correct checkout.
- An overview of running and detached terminal and agent sessions, with reconnect actions.
- Agent attention indicators: working, waiting for input, ended, failed, or unknown.
- A persistent “since you last checked” inbox and morning summary.
- Branch and working-tree status for each checkout.
- Embedded terminal tabs, followed by file browsing, previews, and possibly editing.
- An Android-accessible interface for checking progress and interacting with remote terminal and agent sessions.

Build this incrementally. The first version should be useful without becoming a complete IDE.

**Proposed architecture—not yet a final decision**

The current preference is:

- A shared React/TypeScript web interface.
- An Electron desktop wrapper for Ubuntu.
- An independent service on each managed machine.
- One always-on machine's service hosting the browser interface and aggregating state and events from all machines.
- Android access initially through a responsive browser interface, relaying commands through that aggregating service.
- tmux providing terminal-session persistence initially, but it might be replaced by another backend.
- xterm.js displaying embedded terminals when we reach that milestone, and Monaco as an in-app code editor.

Evaluate this setup before committing. Tauri is an alternative if it offers a meaningful benefit. Backend language, storage, transport, and packaging remain open decisions.

Keep interfaces and process ownership separate: closing or crashing the GUI must not terminate managed work. Each machine should remain usable when the aggregating service is unreachable. Disconnected machines should show timestamped last-known information.

Desktop actions must execute on the intended machine and, where necessary, in its graphical user session. A web interface can request these through an authenticated machine service; it cannot directly launch arbitrary desktop applications by itself.

**Domain model**

Defined in [docs/glossary.md](docs/glossary.md). In short: a **repository** (registered, git required) has **checkouts** (clones or worktrees) on **filesystems** seen by **machines**; machines run our **service**, **terminal sessions** and **agent sessions**; **events** record what happened.

A terminal session and an agent session are different things. Do not assume agent sessions from editor extensions and from the CLI are interchangeable or automatically discoverable. If possible, an overview should list _all_ agent sessions of all providers (e.g. Claude Code, Codex), on any machine, from the CLI or an editor.

**Reference project**

A colleague’s project contains useful ideas:
https://github.com/genomewalker/relay-terminal

Especially relevant are durable remote session identities, structured agent events, machine/workspace/session navigation, and its “since you last checked” inbox.

Its desktop app is macOS-only and uses a custom remote daemon. We want our own Ubuntu-compatible application. Use it as design inspiration; it currently states that no project license has been selected, so do not copy its implementation without appropriate permission. Several sister plugin repositories describe experimental or unreleased features.

**First milestone**

Aim for a small working vertical slice:

1. Register a repository and its local checkout.
2. Show the checkout in a repository overview.
3. Open it in the editor, an external terminal, and the file manager.
4. Create or reconnect to a named terminal session.
5. Reopen the application and recover the registered repositories and terminal sessions.
6. Establish how the same service interface will support other machines later.

Then add remote-machine support, agent events and attention, embedded terminals, and phone access in successive milestones.

**How to proceed**

First inspect the repository and available environment. Present a concise architecture recommendation, the important open decisions, and a staged implementation plan. Identify which choices are costly to change and which can wait.

Then begin the smallest useful implementation. Ask only about missing information that materially blocks progress, and make reasonable reversible choices otherwise. Keep explanations concise, document important decisions, and verify meaningful behaviour rather than producing a large scaffold or speculative abstractions.

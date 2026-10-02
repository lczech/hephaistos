# Glossary

The domain terms used in code, UI and docs. Use the preferred term and avoid the listed alternatives.
The only tool named here is git, because it is the one tool we depend on. Everything else is described by its role.

## Core terms

| Term | Definition |
|---|---|
| **Repository** (repo) | A logical git repository: the unit you register. It spans all its checkouts on all machines. |
| **Checkout** | A git working tree of one repository, at a path on a filesystem. Kind: **clone** (owns its `.git`) or **worktree** (linked to a clone via `git worktree`). |
| **Branch** | A named line of commits, in the usual git sense. Each clone has its own copies, which can diverge. Worktrees share their clone's branches. For now, a branch is part of a checkout's State: current branch (or detached HEAD), ahead/behind its upstream, and whether the working tree is dirty. |
| **Machine** | A computer where processes run and where our Service runs. Each login node or free node of a cluster is its own machine. |
| **Filesystem** | A set of paths that resolve to the same files on every machine that sees it. By default, each machine has its own. A shared cluster filesystem is one filesystem, seen by many machines. |
| **Cluster** | A named set of machines, used only for grouping and filtering in views. A machine may belong to several clusters. |
| **Service** | Our daemon on a machine. It performs authenticated actions there and reports the machine's State. One service also aggregates the others and serves the UI. |
| **Terminal session** | A persistent shell on a machine, with a stable ID. It survives closing the terminal that shows it. The backend is currently tmux. |
| **Terminal** | A window or embedded tab that displays a terminal session. |
| **Provider** | Agent software, e.g. Claude Code or Codex. |
| **Agent session** | One conversation with a provider, with its own ID and transcript. Attributes: provider, machine, working directory, front end (CLI or editor extension). It outlives its process (the transcript stays on disk and can be resumed). Attention state: working / waiting for input / ended / failed / unknown, marked as reported or inferred. |
| **Editor**, **File manager** | Tools we launch, at a directory. |
| **Event** | A timestamped fact about any entity, with its source. The inbox and summaries are views built from events, not entities. |
| **State** | What is currently true on a machine: checkouts' git status, terminal sessions, agent sessions. Read live by that machine's service; a newer reading replaces the older one. Qualify other uses ("attention state"). |
| **Registry** | The user's declarations that no machine can derive: repositories, which checkouts belong to them, clusters, inbox read position, settings. Owned by the aggregating service, cached by the others. See [data ownership](decisions/001-data-ownership.md). |

## Supporting terms

Vocabulary used consistently, but not stored as entities.

- **Directory**: any directory on a filesystem. A checkout is a directory.
- **Working directory**: the directory a process (terminal session, agent session) runs in. It may lie inside a checkout.

## Later

- **Project**: a possible grouping of several repositories (e.g. code, paper, analysis).
- **Workspace**: a saved working arrangement, probably spanning several checkouts.
- **Scheduler**: a job system such as SLURM. Machines can submit to it.
- **Job**: work submitted to a scheduler. It runs on machines the scheduler chooses.

## Relationships

```
Repository 1──* Checkout *──1 Filesystem *──* Machine *──* Cluster
                  │ worktree *──1 clone
Machine 1──* Terminal session ──(working directory)──> Directory
Machine 1──* Agent session ──(working directory)──> Directory
Provider 1──* Agent session
Event ──> any entity
```

## Identity

Every entity and event has a stable, globally unique ID assigned by us. IDs never rely on git hashes, paths, window titles or PIDs alone.

Adding a checkout to a repository:
- The Service reports the checkout's root commits and remote URLs. A match with an existing repository is a *suggestion* that the user confirms. With no match (or no commits yet), the user picks a repository or creates one.
- Worktrees inherit their clone's repository (`git rev-parse --git-common-dir`).
- Checkouts created by the app are assigned directly.
- Forks share root commits and therefore match as the same repository unless the user splits them.

## Avoid

| Avoid | Use |
|---|---|
| computer, host, system | Machine (hostname is only an attribute) |
| server | Machine (hardware) or Service (our daemon) |
| remote / local as types | Machine. Use remote/local only as relative adjectives |
| project (for now) | Repository |
| bare "state" for attributes | qualified, e.g. attention state (bare State is the data category) |
| bare "session" | Terminal session or Agent session |
| bare "agent" | Provider or Agent session |
| conversation | Agent session (providers call it a "session"; its ID is the agent session's provider ID) |
| node | Machine (except "login node"/"compute node" in cluster context) |
| storage, volume, disk | Filesystem |
| tool names (VS Code, tmux, SLURM, …) | Editor, Terminal session, Scheduler, … (git excepted) |

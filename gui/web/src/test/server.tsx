// A stand-in for the Server, and the answers it gives.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import type { Schemas } from "../api/client";
import { QUERY_DEFAULTS } from "../api/queries";
import { builtFor } from "../version";

type Route = (request: Request) => Response | Promise<Response>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Answers requests by `METHOD /path`; returns those asked so far. */
export function serve(routes: Record<string, Route>): Request[] {
  const requests: Request[] = [];
  vi.stubGlobal("fetch", async (request: Request) => {
    requests.push(request);
    const route = routes[`${request.method} ${new URL(request.url).pathname}`];
    return route ? route(request) : json({ error: "no such route" }, 404);
  });
  return requests;
}

/** Renders with a fresh query client, which it also returns, to refresh by hand. */
export function renderWithQueries(ui: ReactNode) {
  const client = new QueryClient(QUERY_DEFAULTS);
  return { ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>), client };
}

export const NOW = Date.parse("2026-10-13T12:00:00Z");

export function secondsAgo(value: number): string {
  return new Date(NOW - value * 1000).toISOString();
}

/** A setting as `/api/config` lists it, applied from its default. */
export function setting(key: string, value: string | number): Schemas["SettingJson"] {
  const type = typeof value === "number" ? "int" : "text";
  return { key, description: "", type, value, source: "default", applied: value };
}

export function info(api = builtFor()): Schemas["InfoJson"] {
  return {
    version: "0.1.0 (abc1234)",
    api,
    machine: { id: "01", name: "laptop" },
    home: "/home/me",
  };
}

export function daemon(): Schemas["DaemonJson"] {
  return {
    unit: null,
    daemon: {
      running: true,
      under_systemd: true,
      pid: 4242,
      version: "0.1.0 (abc1234)",
      started_at: secondsAgo(7200),
      stopped_at: null,
      last_seen_at: secondsAgo(1),
      ended_without_stopping: false,
    },
    watcher: {
      interval: 60,
      last_pass: { finished_at: secondsAgo(20), duration: 0.8, error: null, trigger: "watcher" },
      next_pass_at: new Date(NOW + 40_000).toISOString(),
      stalled: false,
    },
    server: {
      address: "127.0.0.1:8264",
      listening: true,
      error: null,
      requests: 312,
      last_request_at: secondsAgo(2),
      refused: 0,
      live: 1,
    },
    warnings: [],
  };
}

/** An Event as `/api/events` lists it; IDs count up, so later ones are newer. */
export function event(n: number, fields: Partial<Schemas["EventJson"]> = {}): Schemas["EventJson"] {
  const id = `0199e000-0000-7000-8000-${String(n).padStart(12, "0")}`;
  return {
    id,
    recorded_at: secondsAgo(600 - n),
    recorded_by: { id: "0199e000-0000-7000-8000-00000000aaaa", name: "laptop" },
    occurred_at: null,
    priority: 10,
    kind: "clone.committed",
    subject: {
      id: "0199e000-0000-7000-8000-00000000cccc",
      type: "clone",
      name: null,
      path: "/home/me/project",
    },
    repository: { id: "0199e000-0000-7000-8000-00000000dddd", name: "project" },
    summary: `Commit number ${n} (abc${n})`,
    details: [],
    payload: {},
    key: null,
    ...fields,
  };
}

const LAPTOP = { id: "0199e000-0000-7000-8000-00000000aaaa", name: "laptop" };

/** A Checkout's State as the API gives it: clean on `main`, up to date with its upstream. */
function checkoutState(path: string) {
  return {
    observed_at: secondsAgo(30),
    observed_by: LAPTOP,
    active_at: null,
    present: true,
    head: "abc1234",
    branch: "main",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    staged: 0,
    changed: 0,
    untracked: 0,
    conflicted: 0,
    error: null,
    path,
  };
}

/** A Worktree of the Clone at `/home/me/<repository>`, at `<that>/.worktrees/<name>`. */
export function worktree(
  repository: string,
  name: string,
  fields: Partial<Schemas["WorktreeJson"]> = {},
): Schemas["WorktreeJson"] {
  return {
    ...checkoutState(`/home/me/${repository}/.worktrees/${name}`),
    id: `wt-${repository}-${name}`,
    repository: { id: `repo-${repository}`, name: repository },
    clone: { id: `clone-${repository}`, path: `/home/me/${repository}` },
    name,
    lock_reason: null,
    branch: name,
    ...fields,
  };
}

/** A Clone of `repository`, at `/home/me/<repository>`. */
export function clone(
  repository: string,
  fields: Partial<Schemas["CloneJson"]> = {},
): Schemas["CloneJson"] {
  const path = `/home/me/${repository}`;
  return {
    ...checkoutState(path),
    id: `clone-${repository}`,
    repository: { id: `repo-${repository}`, name: repository },
    filesystem: { id: "fs", name: "laptop-local" },
    resolved_path: path,
    created_at: secondsAgo(86_400),
    bare: false,
    branches: ["main"],
    root_commits: ["0000001"],
    remotes: { origin: `git@host:me/${repository}.git` },
    worktrees: [],
    ...fields,
  };
}

/** A Repository named so, with these Clones. */
export function repository(
  name: string,
  clones: Schemas["CloneJson"][] = [],
  fields: Partial<Schemas["RepositoryJson"]> = {},
): Schemas["RepositoryJson"] {
  const times = clones.flatMap((each) => [each, ...each.worktrees]).map((each) => each.active_at);
  return {
    id: `repo-${name}`,
    name,
    created_at: secondsAgo(86_400),
    active_at:
      times
        .filter((at) => at !== null)
        .sort()
        .at(-1) ?? null,
    remotes: [`host/me/${name}`],
    clones,
    ...fields,
  };
}

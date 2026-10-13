// A stand-in for the Server, and the answers it gives.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import type { Schemas } from "../api/client";
import { builtFor } from "../version";

type Route = () => Response | Promise<Response>;

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
    return route ? route() : json({ error: "no such route" }, 404);
  });
  return requests;
}

export function renderWithQueries(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

export const NOW = Date.parse("2026-10-13T12:00:00Z");

export function secondsAgo(value: number): string {
  return new Date(NOW - value * 1000).toISOString();
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

// What the GUI asks the Server; asked again when the live connection hints at a change
// (`live.ts`), never on a timer.

import {
  keepPreviousData,
  type QueryClientConfig,
  type QueryKey,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
} from "@tanstack/react-query";
import { api, unwrap } from "./client";
import type { paths } from "./schema";

/**
 * What answers stay: current until a hint, the page gaining focus or reconnecting says
 * otherwise, so never asked again just for being old. No retries: a failed answer is asked
 * again at the next of those.
 */
export const QUERY_DEFAULTS: QueryClientConfig = {
  defaultOptions: {
    queries: { retry: false, staleTime: Number.POSITIVE_INFINITY, refetchOnWindowFocus: false },
  },
};

/** The queries' keys by name; each names the queries whose keys start with it. */
export const KEYS = {
  info: ["info"],
  daemon: ["daemon"],
  machines: ["machines"],
  repositories: ["repositories"],
  changes: ["changes"],
  config: ["config"],
  eventKinds: ["events", "kinds"],
  events: ["events", "list"],
  log: ["log"],
  db: ["db"],
} as const satisfies Record<string, QueryKey>;

export type KeyName = keyof typeof KEYS;

export function useInfo() {
  return useQuery({
    queryKey: KEYS.info,
    queryFn: async () => unwrap(await api.GET("/api/info")),
  });
}

export function useDaemon() {
  return useQuery({
    queryKey: KEYS.daemon,
    queryFn: async () => unwrap(await api.GET("/api/daemon")),
  });
}

export function useMachines() {
  return useQuery({
    queryKey: KEYS.machines,
    queryFn: async () => unwrap(await api.GET("/api/machines")),
  });
}

/** The Repositories with their Clones and Worktrees. */
export function useRepositories() {
  return useQuery({
    queryKey: KEYS.repositories,
    queryFn: async () => unwrap(await api.GET("/api/repositories")),
  });
}

/** Which Checkout's changes, compared how: `/api/changes`'s parameters. */
export type ChangesQuery = NonNullable<paths["/api/changes"]["get"]["parameters"]["query"]>;

function changesQuery(query: ChangesQuery) {
  return {
    queryKey: [...KEYS.changes, query],
    queryFn: async () => unwrap(await api.GET("/api/changes", { params: { query } })),
  };
}

/**
 * A Checkout's changes, which git reads anew each time: asked again on a hint, as files
 * changed by hand change no State, on focus too. Others keep showing until theirs arrive.
 */
export function useChanges(query: ChangesQuery) {
  return useQuery({
    ...changesQuery(query),
    placeholderData: keepPreviousData,
    enabled: query.clone !== undefined || query.worktree !== undefined,
  });
}

/** The changes within each of these folders, as `useChanges` gives them for the Checkout. */
export function useChangesWithin(query: ChangesQuery, folders: string[]) {
  return useQueries({ queries: folders.map((path) => changesQuery({ ...query, path })) });
}

/** The settings as the Daemon finds them; they change by hand, so asked again on focus. */
export function useConfig() {
  return useQuery({
    queryKey: KEYS.config,
    queryFn: async () => unwrap(await api.GET("/api/config")),
  });
}

/** The kinds of Events the Daemon records: the same until it is another version. */
export function useEventKinds() {
  return useQuery({
    queryKey: KEYS.eventKinds,
    queryFn: async () => unwrap(await api.GET("/api/events/kinds")),
  });
}

export const EVENTS_PAGE = 50;

/** What `/api/events` filters by, as `hephaistos event list` does. */
export type EventFilters = Omit<
  NonNullable<paths["/api/events"]["get"]["parameters"]["query"]>,
  "limit" | "before"
>;

/**
 * Events matching the filters, newest first; each further page goes back from the oldest so far.
 * Other filters keep showing the Events of the ones before, until theirs arrive.
 */
export function useEvents(filters: EventFilters = {}) {
  return useInfiniteQuery({
    queryKey: [...KEYS.events, filters],
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET("/api/events", {
          params: { query: { ...filters, limit: EVENTS_PAGE, before: pageParam } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.length < EVENTS_PAGE ? undefined : page.at(-1)?.id),
    placeholderData: keepPreviousData,
  });
}

export const LOG_PAGE = 50;

/** What `/api/log` filters by, as `hephaistos log show` does. */
export type LogFilters = Omit<
  NonNullable<paths["/api/log"]["get"]["parameters"]["query"]>,
  "limit" | "before"
>;

/** This Machine's log records matching the filters, newest first, paged back as Events are. */
export function useLog(filters: LogFilters = {}) {
  return useInfiniteQuery({
    queryKey: [...KEYS.log, filters],
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET("/api/log", {
          params: { query: { ...filters, limit: LOG_PAGE, before: pageParam } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: ({ entries }) =>
      entries.length < LOG_PAGE ? undefined : entries.at(-1)?.position,
    placeholderData: keepPreviousData,
  });
}

/** The database's tables, with their rows and latest change, as `db tables` lists them. */
export function useDbTables() {
  return useQuery({
    queryKey: [...KEYS.db, "tables"],
    queryFn: async () => unwrap(await api.GET("/api/db/tables")),
  });
}

export const DB_PAGE = 50;

/** A table's rows, newest first; each further page skips those before, as `db dump --offset`. */
export function useDbRows(table: string) {
  return useInfiniteQuery({
    queryKey: [...KEYS.db, "rows", table],
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET("/api/db/tables/{table}", {
          params: { path: { table }, query: { limit: DB_PAGE, offset: pageParam } },
        }),
      ),
    initialPageParam: 0,
    getNextPageParam: (page, pages) =>
      page.rows.length < DB_PAGE ? undefined : pages.length * DB_PAGE,
  });
}

/** Has the Watcher pass; what it found, the other queries show. */
export async function observe(): Promise<void> {
  const answer = await api.POST("/api/observe");
  if (!answer.response.ok) unwrap(answer);
}

/** Asks for a pass; what it changed, the live connection's hints bring. */
export function useObserve() {
  return useMutation({ mutationFn: observe });
}

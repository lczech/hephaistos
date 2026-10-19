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
import { api, type Schemas, unwrap } from "./client";
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
  diff: ["diff"],
  history: ["history"],
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

/** Which file's diff: `/api/diff`'s parameters, which `/api/diff/files` shares. */
/** Which file's change, compared how; the lines around each change come from the settings. */
export type DiffQuery = NonNullable<paths["/api/diff/files"]["get"]["parameters"]["query"]>;

/**
 * A file's change and git's patch, with `gui.diff.context` lines around each hunk, asked once
 * the settings are known (or can't be); again as the Checkout's changes are.
 */
export function useDiff(query: DiffQuery | undefined) {
  const config = useConfig();
  const context = config.data?.settings.find(({ key }) => key === "gui.diff.context")?.applied;
  const asked = query && { ...query, ...(typeof context === "number" && { context }) };
  return useQuery({
    queryKey: [...KEYS.diff, "patch", asked],
    queryFn: async () =>
      unwrap(await api.GET("/api/diff", { params: { query: asked as DiffQuery } })),
    placeholderData: keepPreviousData,
    enabled: asked !== undefined && !config.isPending,
  });
}

/**
 * The file's two versions, asked for after each patch (`patchAt`, when it came), so that they
 * match it: they show where the file ends, and more of it than its patch has.
 */
export function useDiffFiles(query: DiffQuery | undefined, patchAt: number, enabled: boolean) {
  return useQuery({
    queryKey: [...KEYS.diff, "files", query, patchAt],
    queryFn: async () =>
      unwrap(await api.GET("/api/diff/files", { params: { query: query as DiffQuery } })),
    enabled: query !== undefined && enabled,
  });
}

export const HISTORY_PAGE = 50;

/** Which Checkout's commits, from where and of what: `/api/history`'s parameters but paging. */
export type HistoryQuery = Omit<
  NonNullable<paths["/api/history"]["get"]["parameters"]["query"]>,
  "start" | "skip" | "limit"
>;

type HistoryNext = Schemas["HistoryNextJson"];

/**
 * A Checkout's commits, newest first, each further page going on where the one before ended:
 * after a rename, for the file's path before. Asked again as the Checkout's changes are.
 */
export function useHistory(query: HistoryQuery | undefined) {
  return useInfiniteQuery({
    queryKey: [...KEYS.history, query],
    queryFn: async ({ pageParam }) => {
      const after = pageParam && {
        skip: pageParam.skip,
        ...(pageParam.start === null ? {} : { start: pageParam.start }), // none: everywhere
        ...(pageParam.path === null ? {} : { path: pageParam.path }),
      };
      return unwrap(
        await api.GET("/api/history", {
          params: { query: { ...(query as HistoryQuery), ...after, limit: HISTORY_PAGE } },
        }),
      );
    },
    initialPageParam: undefined as HistoryNext | undefined,
    getNextPageParam: (page) => page.next ?? undefined,
    placeholderData: keepPreviousData,
    enabled: query !== undefined,
  });
}

/** The settings as the Daemon finds them; they change by hand, so asked again on focus. */
/** The commit a revision names in a Checkout, as git resolves it: `HEAD~3`, `v1.0^`, a hash. */
export async function resolveRevision(checkout: HistoryQuery, revision: string): Promise<string> {
  const page = unwrap(
    await api.GET("/api/history", { params: { query: { ...checkout, ref: revision, limit: 1 } } }),
  );
  const [commit] = page.commits;
  if (commit === undefined) throw new Error(`${revision} has no commits`);
  return commit.hash;
}

export function useConfig() {
  return useQuery({
    queryKey: KEYS.config,
    queryFn: async () => unwrap(await api.GET("/api/config")),
  });
}

/** The value the Daemon applies for a setting, by its key (`gui.diff.large_lines`); undefined
 * until known. */
export function useSetting(key: string) {
  const config = useConfig();
  return config.data?.settings.find((setting) => setting.key === key)?.applied;
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

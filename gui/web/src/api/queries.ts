// What the GUI asks the Server; asked again when the live connection hints at a change
// (`live.ts`), never on a timer.

import {
  hashKey,
  keepPreviousData,
  type Query,
  type QueryClient,
  type QueryClientConfig,
  type QueryKey,
  type UseQueryResult,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
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
  status: ["status"],
  machines: ["machines"],
  repositories: ["repositories"],
  changes: ["changes"],
  diff: ["diff"],
  history: ["history"],
  graph: ["graph"],
  files: ["files"],
  paths: ["paths"],
  config: ["config"],
  eventKinds: ["events", "kinds"],
  events: ["events", "list"],
  log: ["log"],
  db: ["db"],
} as const satisfies Record<string, QueryKey>;

export type KeyName = keyof typeof KEYS;

/**
 * The key of the versions of a file: not among `KEYS`, so that no hint, focus or connecting asks
 * for them again, as they follow the patch of the file (`useDiffFiles`), and would be asked twice.
 */
export const VERSIONS_KEY = ["versions"] as const;

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

/**
 * The setup, as the Daemon checks it for this: asked only while `shown`, as checking takes calls;
 * while hidden, neither focus nor a reconnect asks again.
 */
export function useStatus(shown: boolean) {
  return useQuery({
    queryKey: KEYS.status,
    queryFn: async () => unwrap(await api.GET("/api/status")),
    enabled: shown,
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

/** The key of the changes `query` names. */
function changesKey(query: ChangesQuery): QueryKey {
  return [...KEYS.changes, query];
}

function changesQuery(query: ChangesQuery) {
  return {
    queryKey: changesKey(query),
    queryFn: async () => unwrap(await api.GET("/api/changes", { params: { query } })),
  };
}

/**
 * A Checkout's changes, which git reads anew each time: asked again on a hint, as files
 * changed by hand change no State, on focus too. Others keep showing until theirs arrive, but
 * not when none are asked for: a disabled query never replaces them, so they would stay stale.
 */
export function useChanges(query: ChangesQuery) {
  const enabled = query.clone !== undefined || query.worktree !== undefined;
  return useQuery({
    ...changesQuery(query),
    placeholderData: (previous) => (enabled ? previous : undefined),
    enabled,
  });
}

/** The changes within each of these folders, as `useChanges` gives them for the Checkout. */
export function useChangesWithin(query: ChangesQuery, folders: string[]) {
  return useQueries({ queries: folders.map((path) => changesQuery({ ...query, path })) });
}

/** Which Directory's entries, with which fields: `/api/files`'s parameters. */
export type FilesQuery = NonNullable<paths["/api/files"]["get"]["parameters"]["query"]>;

/** What a Directory holds, as `/api/files` lists it: to ask for it, or for it ahead of time. */
export function filesQuery(query: FilesQuery) {
  return {
    queryKey: [...KEYS.files, query],
    queryFn: async () => unwrap(await api.GET("/api/files", { params: { query } })),
  };
}

/**
 * What each of these Directories holds, read anew on a hint or focus, as files change by hand.
 * One asked for with other fields than before shows the answer last given with fields until
 * its own comes: showing a column keeps git's letters meanwhile.
 */
export function useFilesOf(queries: FilesQuery[]) {
  const client = useQueryClient();
  return useQueries({
    queries: queries.map((query) => ({
      ...filesQuery(query),
      placeholderData: query.fields?.length ? () => withFields(client, query.path) : undefined,
    })),
  });
}

/**
 * Of the listings kept, those to ask again: a Directory's names alone only where none with
 * fields is kept for it, as one with fields holds the names too, and git is read for it anyway.
 */
export function listingsAskedAgain(client: QueryClient): (query: Query) => boolean {
  const asked = (query: Query) => query.queryKey[1] as FilesQuery | undefined;
  const withFields = new Set(
    client
      .getQueryCache()
      .findAll({ queryKey: KEYS.files })
      .map(asked)
      .filter((query) => !!query?.fields?.length)
      .map((query) => query?.path),
  );
  return (query) => !!asked(query)?.fields?.length || !withFields.has(asked(query)?.path);
}

/** The answer last given for the Directory at `path` with any fields, if one is kept. */
function withFields(client: QueryClient, path: string): Schemas["FilesJson"] | undefined {
  const kept = client
    .getQueryCache()
    .findAll({ queryKey: KEYS.files })
    .filter((found) => {
      const asked = found.queryKey[1] as FilesQuery | undefined;
      return asked?.path === path && !!asked.fields?.length && found.state.data !== undefined;
    });
  const last = kept.sort((one, other) => other.state.dataUpdatedAt - one.state.dataUpdatedAt)[0];
  return last?.state.data as Schemas["FilesJson"] | undefined;
}

/** Below which Directory, and which: `/api/files/paths`' parameters. */
export type PathsQuery = NonNullable<paths["/api/files/paths"]["get"]["parameters"]["query"]>;

/**
 * Every path below a Directory, to find files by name; while `query` is given. Asked again on
 * focus or by reloading, not on hints: listing all may take seconds. Asked for otherwise below
 * the same Directory, e.g. with hidden ones, it shows what came before until the answer does.
 */
export function usePathsBelow(query: PathsQuery | undefined) {
  return useQuery({
    queryKey: [...KEYS.paths, query],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/files/paths", { params: { query: query ?? { path: "" } }, signal }),
      ),
    placeholderData: (previous, before) => {
      const asked = before?.queryKey[1] as PathsQuery | undefined;
      return asked !== undefined && asked.path === query?.path ? previous : undefined;
    },
    enabled: query !== undefined,
  });
}

/** Which file's diff: `/api/diff`'s parameters, which `/api/diff/files` shares. */
/** Which file's change, compared how; the lines around each change come from the settings. */
export type DiffQuery = NonNullable<paths["/api/diff/files"]["get"]["parameters"]["query"]>;

/** The lines around each hunk, from the settings once known; undefined while they are not. */
function useDiffContext(): { context?: number } | undefined {
  const config = useConfig();
  if (config.isPending) return undefined;
  const context = config.data?.settings.find(({ key }) => key === "gui.diff.context")?.applied;
  return typeof context === "number" ? { context } : {};
}

/**
 * The key of the patch of a file, or of all patches of a comparison, as `asked`; undefined while
 * it cannot be asked yet, for a disabled query.
 */
function diffKey(kind: "patch" | "all", asked: DiffQuery | DiffsQuery | undefined) {
  return [...KEYS.diff, kind, asked];
}

function diffQuery(asked: DiffQuery | undefined) {
  return {
    queryKey: diffKey("patch", asked),
    queryFn: async () =>
      unwrap(await api.GET("/api/diff", { params: { query: asked as DiffQuery } })),
  };
}

/**
 * A file's change and git's patch, with `gui.diff.context` lines around each hunk, asked once
 * the settings are known (or cannot be); again as the Checkout's changes are.
 */
export function useDiff(query: DiffQuery | undefined) {
  const context = useDiffContext();
  const asked = query && context && { ...query, ...context };
  return useQuery({
    ...diffQuery(asked),
    placeholderData: keepPreviousData,
    enabled: asked !== undefined,
  });
}

/** These files' diffs, as `useDiff` asks for each: e.g. those its sections show. */
export function useDiffsOf(base: Omit<DiffQuery, "path">, paths: readonly string[]) {
  const context = useDiffContext();
  return useQueries({
    queries: paths.map((path) => ({
      ...diffQuery(context && { ...base, path, ...context }),
      enabled: context !== undefined,
    })),
  });
}

/** Which comparison to show the diffs of: the parameters of `/api/diffs`, without the page. */
export type DiffsQuery = Omit<DiffQuery, "path">;

/**
 * All diffs of a comparison but its untracked files', with the files' new versions, page after
 * page: e.g. to find in. Each file's is kept as `useDiff` would ask for it, unless it was asked
 * already, so that its section has it at once.
 */
export function useDiffs(query: DiffsQuery | undefined) {
  const context = useDiffContext();
  const client = useQueryClient();
  const asked = query && context && { ...query, ...context };
  return useQuery({
    queryKey: diffKey("all", asked),
    queryFn: async () => {
      const diffs: Schemas["DiffJson"][] = [];
      const texts: Record<string, string | null> = {};
      for (let skip: number | null = 0; skip !== null; ) {
        const page: Schemas["DiffsJson"] = unwrap(
          await api.GET("/api/diffs", { params: { query: { ...asked, skip, new: true } } }),
        );
        diffs.push(...page.diffs);
        Object.assign(texts, page.new);
        skip = page.next;
      }
      for (const diff of diffs) {
        if (!diff.change) continue;
        const { queryKey } = diffQuery({ ...(asked as DiffsQuery), path: diff.change.path });
        if (client.getQueryData(queryKey) === undefined) client.setQueryData(queryKey, diff);
      }
      return { diffs, texts };
    },
    enabled: asked !== undefined,
  });
}

/**
 * The file's two versions, asked for after each patch (`patchAt`), so that they match it: they
 * show where the file ends, and more of it than its patch has. Also after a patch that could
 * not come, as the file may have changed all the same.
 */
export function useDiffFiles(
  query: DiffQuery | undefined,
  patch: Pick<UseQueryResult, "dataUpdatedAt" | "errorUpdatedAt">,
  enabled: boolean,
) {
  const client = useQueryClient();
  const patchAt = Math.max(patch.dataUpdatedAt, patch.errorUpdatedAt);
  const file = [...VERSIONS_KEY, query];
  return useQuery({
    queryKey: [...file, patchAt],
    queryFn: async () => {
      const versions = unwrap(
        await api.GET("/api/diff/files", { params: { query: query as DiffQuery } }),
      );
      // Those after patches before, which nothing shows any more: not kept until collected.
      const cache = client.getQueryCache();
      for (const before of cache.findAll({ queryKey: file })) {
        const at = before.queryKey[file.length];
        const same = hashKey(before.queryKey.slice(0, file.length)) === hashKey(file);
        if (same && at !== patchAt && before.getObserversCount() === 0) cache.remove(before);
      }
      return versions;
    },
    enabled: query !== undefined && enabled,
  });
}

/**
 * The hash of `key` up to `length`, its last part a query without `path` and `context`: the same
 * for a list and for each file or folder within it (its `path`), with any lines around
 * (`context`), whatever comes after.
 */
function hashWithin(key: QueryKey, length: number): string | undefined {
  const asked = key[length - 1];
  if (typeof asked !== "object" || asked === null) return undefined;
  const { path: _, context: __, ...query } = asked as { path?: unknown; context?: unknown };
  return hashKey([...key.slice(0, length - 1), query]);
}

/**
 * Asks again for the queries of `own` and those within it, as `hashWithin` makes them alike;
 * an `own` with a `path` or `context` stands for its whole query. Keys are matched so, not
 * partially: a partial match of `{ clone }` would match every comparison.
 */
function refreshWithin(client: QueryClient, own: QueryKey) {
  const hash = hashWithin(own, own.length);
  void client.invalidateQueries({
    queryKey: own.slice(0, -1),
    predicate: ({ queryKey }) => hashWithin(queryKey, own.length) === hash,
  });
}

/** Asks again for the changes `query` names and those within its folders, as a list shows. */
export function refreshChanges(client: QueryClient, query: ChangesQuery) {
  refreshWithin(client, changesKey(query));
}

/**
 * The changes of a file in its Checkout, compared in no way, which say where its changes are now
 * when it has none compared as `query` asks: between two revisions only, as a commit's file
 * never says so.
 */
function changesNowQuery({ from, to, commit: _, ...file }: DiffQuery): ChangesQuery | undefined {
  return from && to ? file : undefined;
}

/** Where the changes of a file are now, when it has none compared as `query` asks. */
export function useChangesNow(query: DiffQuery) {
  return useChanges(changesNowQuery(query) ?? {});
}

/**
 * Asks again for the changes and the diffs of this comparison in this Checkout: its lists and
 * each file's patch, not those of others. Each file's versions follow its patch
 * (`useDiffFiles`), so are not asked for here, which would ask twice. With a `path`, also where
 * the changes of that file are now (`useChangesNow`).
 */
export function refreshComparison(client: QueryClient, compared: DiffsQuery, path?: string) {
  refreshChanges(client, compared);
  refreshWithin(client, diffKey("patch", compared));
  refreshWithin(client, diffKey("all", compared));
  const now = path === undefined ? undefined : changesNowQuery({ ...compared, path });
  if (now) void client.invalidateQueries({ queryKey: changesKey(now), exact: true });
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
 * Each page holds the `query` it answers: while the next one loads, those of the one before show.
 */
export function useHistory(query: HistoryQuery | undefined) {
  return useInfiniteQuery({
    queryKey: [...KEYS.history, query],
    queryFn: async ({ pageParam }) => {
      const asked = query as HistoryQuery;
      const after = pageParam && {
        skip: pageParam.skip,
        ...(pageParam.start === null ? {} : { start: pageParam.start }), // none: everywhere
        ...(pageParam.path === null ? {} : { path: pageParam.path }),
      };
      const page = unwrap(
        await api.GET("/api/history", {
          params: { query: { ...asked, ...after, limit: HISTORY_PAGE } },
        }),
      );
      return { ...page, query: asked };
    },
    initialPageParam: undefined as HistoryNext | undefined,
    getNextPageParam: (page) => page.next ?? undefined,
    placeholderData: keepPreviousData,
    enabled: query !== undefined,
  });
}

/** The Clone of which Checkout: the parameters of `/api/graph`. */
export type GraphQuery = NonNullable<paths["/api/graph"]["get"]["parameters"]["query"]>;

/**
 * What a graph of a Clone shows besides its commits: its default branch, how far each branch is
 * ahead of it and behind it, and where each of its Checkouts is. Asked again as its history is.
 */
export function useGraph(checkout: GraphQuery | undefined) {
  return useQuery({
    queryKey: [...KEYS.graph, checkout],
    queryFn: async () =>
      unwrap(await api.GET("/api/graph", { params: { query: checkout as GraphQuery } })),
    placeholderData: keepPreviousData,
    enabled: checkout !== undefined,
  });
}

/** The commits of the walk of a graph as it lays them out: the parameters of `/api/graph/lines`. */
export type GraphLinesQuery = NonNullable<paths["/api/graph/lines"]["get"]["parameters"]["query"]>;

/**
 * The commits of the walk of a graph as it lays them out, hashes, parents and refs only: up to
 * `limit`, until each of `until` has come. Asked again with the other queries of the graph.
 */
export function useGraphLines(query: GraphLinesQuery | undefined) {
  return useQuery({
    queryKey: [...KEYS.graph, "lines", query],
    queryFn: async () =>
      unwrap(await api.GET("/api/graph/lines", { params: { query: query as GraphLinesQuery } })),
    placeholderData: keepPreviousData, // a HEAD moved: the lines as they were, until these come
    enabled: query !== undefined,
  });
}

/** The commit a revision names in a Checkout, as git resolves it: `HEAD~3`, `v1.0^`, a hash. */
export async function resolveRevision(checkout: HistoryQuery, revision: string): Promise<string> {
  const page = unwrap(
    await api.GET("/api/history", { params: { query: { ...checkout, ref: revision, limit: 1 } } }),
  );
  const [commit] = page.commits;
  if (commit === undefined) throw new Error(`${revision} has no commits`);
  return commit.hash;
}

/** The settings as the Daemon finds them; they change by hand, so asked again on focus. */
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

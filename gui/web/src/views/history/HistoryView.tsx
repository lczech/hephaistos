import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import {
  type HistoryQuery,
  KEYS,
  useChanges,
  useHistory,
  useRepositories,
} from "../../api/queries";
import { GitRevisionPicker } from "../../components/GitRevisionPicker";
import { SearchField } from "../../components/SearchField";
import { ListTable } from "../../components/table/ListTable";
import { useListTable } from "../../components/table/list";
import { columnWidths } from "../../components/table/widths";
import { BarEnd, Refresh, ViewBar } from "../../components/ViewBar";
import { HEAD, revisionText } from "../../revisions";
import { useDebounced } from "../../useDebounced";
import { useNow } from "../../useNow";
import { type Params, paramValues } from "../address";
import { type Checkout, checkoutName, checkoutOf, checkoutState } from "../changes/checkout";
import type { ViewProps } from "../index";
import { useIsShown } from "../opening";
import { CommitBox } from "./CommitBox";
import { historyColumns } from "./columns";
import styles from "./HistoryView.module.css";
import {
  entryId,
  historyTitle,
  noneFoundText,
  searchedEntries,
  searchWords,
  uncommittedText,
} from "./rows";

const SEARCH_DELAY = 300; // ms after the last key typed

/**
 * A Checkout's commits, newest first, as `git log` walks back from HEAD, or from the branch,
 * tag or commit its parameter `ref` names; with `path`, only those that changed a file or folder,
 * following a file's renames; with `search`, only those whose message has all its words, in
 * any order and case. A commit's row opens all about it; its hash, its changes.
 */
export function HistoryView({ params, setParams, setTitle }: ViewProps) {
  const checkout = useMemo(() => checkoutOf(params), [params]); // the columns depend on it
  const isShown = useIsShown();
  const [ref] = paramValues(params.ref);
  const [path] = paramValues(params.path);
  const [search = ""] = paramValues(params.search);
  // Asked for once typing pauses, or at once on Enter.
  const [searched, searchNow] = useDebounced(search, SEARCH_DELAY);
  const words = searchWords(searched);
  const query: HistoryQuery | undefined = checkout && {
    ...checkout,
    ...(ref === undefined ? {} : { ref }),
    ...(path === undefined ? {} : { path }),
    ...(words.length === 0 ? {} : { search: words.join(" ") }),
  };
  const history = useHistory(query);
  const client = useQueryClient();
  const repositories = useRepositories();
  const name = checkout && checkoutName(repositories.data, checkout);
  const title = historyTitle(name, ref, path, words);
  useEffect(() => {
    if (title !== undefined) setTitle(title);
  }, [title, setTitle]);
  const now = useNow(10_000);

  const first = history.data?.pages[0];
  // What isn't committed shows above HEAD's commits, but has no message to search.
  const uncommitted = useUncommitted(
    checkout,
    path,
    ref === undefined && words.length === 0 && first !== undefined,
  );
  const listed = useMemo(
    () => [
      ...(uncommitted ? [{ type: "uncommitted" as const, text: uncommitted }] : []),
      ...searchedEntries(first?.found, history.data?.pages.flatMap((page) => page.commits) ?? []),
    ],
    [history.data, first, uncommitted],
  );
  // A commit searched for by its hash, not listed, shows on its branch, or among all files.
  const walked = revisionText(ref ?? first?.branch ?? HEAD);
  const showOn = useCallback(
    (other: string) => setParams({ ...params, ref: other }),
    [params, setParams],
  );
  const allFiles = useCallback(() => {
    const { path: _, ...others } = params;
    setParams(others);
  }, [params, setParams]);
  const columns = useMemo(
    () => historyColumns(checkout, first?.head, { walked, path, showOn, allFiles }),
    [checkout, first?.head, walked, path, showOn, allFiles],
  );
  const table = useListTable({
    columns,
    data: listed,
    getRowId: entryId,
    atoms: { columnSizing: columnWidths("history") },
    meta: { now },
  });

  const without = (name: string): Params => {
    const { [name]: _, ...others } = params;
    return others;
  };
  let message: string | null = null;
  if (checkout === undefined) {
    message = "No Checkout: open History from a Clone or Worktree in Repositories.";
  } else if (history.data === undefined && !history.isError) {
    message = "Loading commits…";
  } else if (history.data !== undefined && listed.length === 0) {
    if (words.length > 0) message = noneFoundText(words, path);
    else message = path === undefined ? "No commits yet." : `No commits changed ${path}.`;
  }
  return (
    <section className={styles.view}>
      <ViewBar>
        {checkout && (
          <GitRevisionPicker
            className={styles.control}
            checkout={checkout}
            label="Branch, tag or commit"
            title="Show the commits of a branch, tag or commit, and those before; HEAD is what is checked out"
            value={ref ?? HEAD}
            // HEAD as no `ref`: the commits of whatever is checked out, as that changes.
            onChange={(revision) =>
              setParams(revision === HEAD ? without("ref") : { ...params, ref: revision })
            }
            rows={[HEAD]}
            tabs={["branches", "tags", "commits"]}
            commitsFrom="everywhere"
            known={first}
          />
        )}
        {path !== undefined && (
          <span className={styles.only} title={`Only commits that changed ${path}`}>
            {path}
            <button
              type="button"
              className={styles.clear}
              onClick={() => setParams(without("path"))}
              aria-label="Show all commits"
              title="Show all commits"
            >
              <X aria-hidden="true" />
            </button>
          </span>
        )}
        {checkout && (
          <SearchField
            className={styles.control}
            label="Search hashes or messages"
            placeholder="Hash or message"
            title="Only commits whose message has all these words, in any order and case; or for a hash, its commit"
            value={search}
            onSubmit={searchNow}
            onChange={(text) =>
              setParams(
                searchWords(text).length > 0 ? { ...params, search: text } : without("search"),
              )
            }
          />
        )}
        <BarEnd>
          <Refresh
            busy={history.isFetching}
            onClick={() => void client.invalidateQueries({ queryKey: KEYS.history })}
          />
        </BarEnd>
      </ViewBar>
      {history.isError && (
        <p className={styles.note}>
          Couldn't load: {history.error.message}{" "}
          {ref !== undefined && (
            <button
              type="button"
              className={styles.action}
              onClick={() => setParams(without("ref"))}
            >
              From HEAD
            </button>
          )}
        </p>
      )}
      <ListTable
        table={table}
        className={styles.history}
        choices={{}}
        message={message}
        stale={history.isError || history.isPlaceholderData}
        paging={history}
        older="commits"
        detailsLabel="Commit details"
        details={(entry) =>
          entry.type === "commit" &&
          checkout && <CommitBox commit={entry.commit} checkout={checkout} now={now} />
        }
        plain={(entry) => entry.type !== "commit"}
        showing={(entry) =>
          entry.type === "commit" &&
          checkout !== undefined &&
          isShown({ kind: "changes", params: { ...checkout, commit: entry.commit.hash } })
        }
      />
    </section>
  );
}

/**
 * What is not committed in the Checkout, in words, while its HEAD's commits show: from its
 * State, or for a path, from git; undefined if nothing is.
 */
function useUncommitted(
  checkout: Checkout | undefined,
  path: string | undefined,
  shown: boolean,
): string | undefined {
  const repositories = useRepositories();
  const asked = shown && checkout !== undefined && path !== undefined;
  const changes = useChanges(asked ? { ...checkout, path } : {});
  if (!shown || checkout === undefined) return undefined;
  let counts = { conflicted: 0, staged: 0, changed: 0, untracked: 0 };
  if (path === undefined) {
    const state = checkoutState(repositories.data, checkout);
    if (state === undefined || state.staged === null) return undefined; // bare: no working tree
    counts = {
      conflicted: state.conflicted ?? 0,
      staged: state.staged,
      changed: state.changed ?? 0,
      untracked: state.untracked ?? 0,
    };
  } else {
    const names = { unmerged: "conflicted", staged: "staged", unstaged: "changed" } as const;
    for (const group of changes.data?.groups ?? []) {
      const name =
        group.name === "untracked" ? "untracked" : names[group.name as keyof typeof names];
      if (name !== undefined) counts[name] += group.count;
    }
  }
  const text = uncommittedText(counts);
  return text ? `Uncommitted: ${text}` : undefined;
}

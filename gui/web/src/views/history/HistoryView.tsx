import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import {
  type HistoryQuery,
  KEYS,
  useChanges,
  useHistory,
  useRepositories,
} from "../../api/queries";
import { GitRevisionPicker } from "../../components/GitRevisionPicker";
import { IconButton } from "../../components/IconButton";
import { useListLayout } from "../../components/list/kept";
import { LayoutToggle } from "../../components/list/LayoutToggle";
import { SearchField } from "../../components/SearchField";
import { BarEnd, BarGroup, Refresh, ViewBar, ViewPage } from "../../components/ViewBar";
import { HEAD, revisionText } from "../../revisions";
import { searchWords } from "../../text";
import { useDebounced } from "../../useDebounced";
import { useNow } from "../../useNow";
import { type Params, paramValues, withParam } from "../address";
import { Gone, isGone, LoadNote, useKeptError } from "../CheckoutError";
import { type Checkout, checkoutName, checkoutOf, checkoutState } from "../checkout";
import { CommitList } from "../commits/CommitList";
import { OrderToggle, orderOf, withOrder } from "../commits/OrderToggle";
import { searchedEntries, uncommittedText } from "../commits/rows";
import type { ViewProps } from "../index";
import { useTitle } from "../title";
import styles from "./HistoryView.module.css";
import { historyTitle, noneFoundText } from "./text";

const SEARCH_DELAY = 300; // ms after the last key typed

/**
 * A Checkout's commits, newest first, as `git log` walks back from HEAD, or from the branch,
 * tag or commit its parameter `ref` names; with `path`, only those that changed a file or folder,
 * following a file's renames; with `search`, only those whose message has all its words, in
 * any order and case. A commit's row opens all about it; its hash, its changes.
 */
export function HistoryView({ params, setParams, endTyping, setTitle }: ViewProps) {
  const checkout = checkoutOf(params);
  const [ref] = paramValues(params.ref);
  const [path] = paramValues(params.path);
  const [search = ""] = paramValues(params.search);
  const order = orderOf(params, "date");
  // Asked for once typing pauses, or at once on Enter.
  const [searched, searchNow] = useDebounced(search, SEARCH_DELAY);
  const words = searchWords(searched);
  const query: HistoryQuery | undefined = checkout && {
    ...checkout,
    ...(ref === undefined ? {} : { ref }),
    ...(path === undefined ? {} : { path }),
    ...(words.length === 0 ? {} : { search: words.join(" ") }),
    order,
  };
  const history = useHistory(query);
  const error = useKeptError(history, query);
  const client = useQueryClient();
  const repositories = useRepositories();
  const name = checkout && checkoutName(repositories.data, checkout);
  const title = historyTitle(name, ref, path, words);
  useTitle(setTitle, title);
  const now = useNow(10_000);

  const first = history.data?.pages[0];
  // What is not committed shows above HEAD's commits, but has no message to search.
  const uncommitted = useUncommitted(
    checkout,
    path,
    ref === undefined && words.length === 0 && first !== undefined,
  );
  const listed = [
    ...(uncommitted ? [{ type: "uncommitted" as const, text: uncommitted }] : []),
    ...searchedEntries(first?.found, history.data?.pages.flatMap((page) => page.commits) ?? []),
  ];
  // A commit searched for by its hash, not listed, shows on its branch, or among all files.
  const walked = revisionText(ref ?? first?.branch ?? HEAD);
  const showOn = (other: string) => setParams({ ...params, ref: other });
  const allFiles = () => setParams(withParam(params, "path", []));
  const [layout, setLayout] = useListLayout("history");

  const without = (name: string): Params => withParam(params, name, []);
  let message: string | null = null;
  if (checkout === undefined) {
    message = "No checkout: open History from a clone or worktree in Repositories.";
  } else if (history.data === undefined && error === null) {
    message = "Loading commits…";
  } else if (history.data !== undefined && listed.length === 0) {
    if (words.length > 0) message = noneFoundText(words, path);
    else message = path === undefined ? "No commits yet." : `No commits changed ${path}.`;
  }
  if (isGone(error)) {
    return (
      <ViewPage>
        <Gone error={error} />
      </ViewPage>
    );
  }
  return (
    <ViewPage>
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
            <IconButton
              icon={X}
              label="Show all commits"
              onClick={() => setParams(without("path"))}
            />
          </span>
        )}
        {checkout && (
          <SearchField
            className={styles.control}
            label="Search hashes or messages"
            placeholder="Hash or message"
            byCtrlF
            title="Only commits whose message has all these words, in any order and case; or for a hash, its commit"
            value={search}
            onSubmit={() => {
              searchNow();
              endTyping();
            }}
            onBlur={endTyping}
            onChange={(text) =>
              setParams(
                searchWords(text).length > 0 ? { ...params, search: text } : without("search"),
                true,
              )
            }
          />
        )}
        <BarEnd>
          <BarGroup>
            <OrderToggle
              order={order}
              onChange={(next) => setParams(withOrder(params, next, "date"))}
            />
            <LayoutToggle layout={layout} onChange={setLayout} />
          </BarGroup>
          <BarGroup>
            <Refresh
              busy={history.isFetching}
              onClick={() => void client.invalidateQueries({ queryKey: KEYS.history })}
            />
          </BarGroup>
        </BarEnd>
      </ViewBar>
      {error && (
        <LoadNote error={error}>
          {ref !== undefined && (
            <button
              type="button"
              className={styles.action}
              onClick={() => setParams(without("ref"))}
            >
              From HEAD
            </button>
          )}
        </LoadNote>
      )}
      <CommitList
        kind="history"
        checkout={checkout}
        entries={listed}
        head={first?.head}
        actions={{ walked, path, showOn, allFiles }}
        layout={layout}
        now={now}
        message={message}
        stale={error !== null || history.isPlaceholderData}
        paging={history}
        // Not for a path or a search, which leave commits out between those listed.
        graph={path === undefined && words.length === 0}
      />
    </ViewPage>
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

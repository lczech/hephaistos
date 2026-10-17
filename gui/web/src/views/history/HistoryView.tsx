import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useMemo } from "react";
import {
  type HistoryQuery,
  KEYS,
  useChanges,
  useHistory,
  useRepositories,
} from "../../api/queries";
import { ListTable } from "../../components/table/ListTable";
import { useListTable } from "../../components/table/list";
import { columnWidths } from "../../components/table/widths";
import { BarEnd, Refresh, ViewBar } from "../../components/ViewBar";
import { useNow } from "../../useNow";
import { type Params, paramValues } from "../address";
import { type Checkout, checkoutName, checkoutOf, checkoutState } from "../changes/checkout";
import type { ViewProps } from "../index";
import { useIsShown } from "../opening";
import { CommitBox } from "./CommitBox";
import { historyColumns } from "./columns";
import styles from "./HistoryView.module.css";
import { entries, entryId, headText, historyTitle, type Ref, uncommittedText } from "./rows";

const GROUPS: [Ref["kind"], string][] = [
  ["branch", "Branches"],
  ["remote", "Remote branches"],
  ["tag", "Tags"],
];

/**
 * A Checkout's commits, newest first, as `git log` walks back from HEAD, or from the branch or
 * tag its parameter `ref` names; with `path`, only those that changed a file or folder,
 * following a file's renames. A commit's row opens all about it; its hash, its changes.
 */
export function HistoryView({ params, setParams, setTitle }: ViewProps) {
  const checkout = useMemo(() => checkoutOf(params), [params]); // the columns depend on it
  const isShown = useIsShown();
  const [ref] = paramValues(params.ref);
  const [path] = paramValues(params.path);
  const query: HistoryQuery | undefined = checkout && {
    ...checkout,
    ...(ref === undefined ? {} : { ref }),
    ...(path === undefined ? {} : { path }),
  };
  const history = useHistory(query);
  const client = useQueryClient();
  const repositories = useRepositories();
  const name = checkout && checkoutName(repositories.data, checkout);
  const title = historyTitle(name, ref, path);
  useEffect(() => {
    if (title !== undefined) setTitle(title);
  }, [title, setTitle]);
  const now = useNow(10_000);

  const first = history.data?.pages[0];
  const uncommitted = useUncommitted(checkout, path, ref === undefined && first !== undefined);
  const listed = useMemo(
    () => [
      ...(uncommitted ? [{ type: "uncommitted" as const, text: uncommitted }] : []),
      ...entries(history.data?.pages.flatMap((page) => page.commits) ?? []),
    ],
    [history.data, uncommitted],
  );
  const columns = useMemo(() => historyColumns(checkout, first?.head), [checkout, first?.head]);
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
    message = "Asking git…";
  } else if (history.data !== undefined && listed.length === 0) {
    message = path === undefined ? "No commits yet." : `No commits changed ${path}.`;
  }
  return (
    <section className={styles.view}>
      <ViewBar>
        {checkout && (
          <select
            className={styles.ref}
            aria-label="Commits from"
            title="The branch or tag whose commits show; HEAD follows what is checked out"
            value={ref ?? ""}
            onChange={(event) =>
              setParams(
                event.target.value ? { ...params, ref: event.target.value } : without("ref"),
              )
            }
          >
            <option value="">{headText(first?.head, first?.branch)}</option>
            {ref !== undefined && !first?.refs.some((known) => known.name === ref) && (
              <option value={ref}>{ref}</option>
            )}
            {GROUPS.map(([kind, label]) => {
              const refs = first?.refs.filter((known) => known.kind === kind) ?? [];
              return (
                refs.length > 0 && (
                  <optgroup key={kind} label={label}>
                    {refs.map((known) => (
                      <option key={known.name} value={known.name}>
                        {known.name}
                      </option>
                    ))}
                  </optgroup>
                )
              );
            })}
          </select>
        )}
        {path !== undefined && (
          <span className={styles.only} title={`Only the commits that changed ${path}`}>
            {path}
            <button
              type="button"
              className={styles.clear}
              onClick={() => setParams(without("path"))}
              aria-label={`All commits, not only those that changed ${path}`}
              title="All commits"
            >
              <X aria-hidden="true" />
            </button>
          </span>
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
          No answer: {history.error.message}{" "}
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

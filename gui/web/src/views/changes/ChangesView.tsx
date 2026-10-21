import { useQueryClient } from "@tanstack/react-query";
import { useAtom } from "@tanstack/react-store";
import { LayoutList, List } from "lucide-react";
import { type MouseEvent, useState } from "react";
import { KEYS, useChanges, useRepositories } from "../../api/queries";
import { ListTable } from "../../components/table/ListTable";
import { BarEnd, Choice, Refresh, ViewBar } from "../../components/ViewBar";
import { HEAD, revisionText, shortHash, WORKING_TREE } from "../../revisions";
import { useNow } from "../../useNow";
import { type Address, type Params, paramValues } from "../address";
import { CommitBelow, CommitLine } from "../history/CommitHeader";
import type { ViewProps } from "../index";
import { clickOpening, useIsShown, useOpenView } from "../opening";
import { sortingOf, withSorting } from "../sorting";
import { useTitle } from "../title";
import { ViewLink } from "../ViewLink";
import styles from "./ChangesView.module.css";
import { ComparedPickers } from "./ComparedPickers";
import { checkoutName, checkoutOf } from "./checkout";
import { useFolds } from "./folds";
import { changesLook, NestedChoice } from "./look";
import {
  arrowText,
  type Compared,
  comparison,
  DEFAULT_SORT,
  type Entry,
  isFolder,
  SORTS,
} from "./rows";
import { useChangesTable } from "./table";

const SINCE_HEAD = { from: HEAD, to: WORKING_TREE };

/**
 * What changed in a Checkout, as git reads it now: from one Revision to another (its parameters
 * `from` and `to`, picked in its bar), without them since HEAD, in the groups `git status` shows
 * unless chosen together; or what a commit changed (`commit`), its line in the bar instead.
 * Groups and directories open and close, and so do new folders, whose files are asked for once
 * opened.
 */
export function ChangesView({ params, setParams, setTitle }: ViewProps) {
  const checkout = checkoutOf(params);
  const [commit] = paramValues(params.commit);
  const picked = comparison(params) ?? SINCE_HEAD;
  const sinceHead = picked.from === SINCE_HEAD.from && picked.to === SINCE_HEAD.to;
  // Since HEAD, staged changes apart as `git status` shows them, unless chosen together.
  const [look, setLook] = useAtom(changesLook());
  const grouped = commit === undefined && sinceHead && look.grouped;
  const compared = commit === undefined && !grouped ? picked : undefined;
  const query = { ...checkout, ...(commit === undefined ? compared : { commit }) };
  const changes = useChanges(query);
  const client = useQueryClient();
  const repositories = useRepositories();
  const now = useNow(10_000);
  const name = checkout && checkoutName(repositories.data, checkout);
  const shown = changes.data?.commit;
  const [details, setDetails] = useState(false); // a commit's, below the bar
  let comparing = compared && !sinceHead ? `, ${arrowText(compared)}` : "";
  if (commit !== undefined) {
    const subject = shown?.commit?.subject;
    comparing = `, ${shortHash(commit)}${subject ? ` ${subject}` : ""}`;
  }
  const title = name && `Changes: ${name}${comparing}`;
  useTitle(setTitle, title);
  const groups = changes.data?.groups ?? [];

  const sorted = sortingOf(params, SORTS, DEFAULT_SORT);
  const [folded, setFolded] = useFolds("changes", checkout);
  const { table, folds } = useChangesTable({
    query,
    groups,
    folded,
    onFoldedChange: setFolded,
    sorted,
    onSortedChange: (next) => setParams(withSorting(params, next, DEFAULT_SORT)),
    nested: look.nested,
    totalled: true,
  });
  // A file's row opens its diff, as a link does.
  const openView = useOpenView();
  const isShown = useIsShown();
  const diffOf = (entry: Entry): Address | undefined => {
    if (entry.type !== "change" || isFolder(entry.change) || checkout === undefined) return;
    const { group, change } = entry;
    const states: Params = commit === undefined ? { from: group.from, to: group.to } : { commit };
    return { kind: "diff", params: { ...checkout, ...states, path: change.path } };
  };
  const opens = (entry: Entry) => {
    const diff = diffOf(entry);
    return diff && ((click: MouseEvent) => openView(diff, clickOpening(click)));
  };
  const showing = (entry: Entry) => {
    const diff = diffOf(entry);
    return diff !== undefined && isShown(diff);
  };
  let message: string | null = null;
  if (checkout === undefined) {
    message = "No Checkout: open Changes from a Clone or Worktree in Repositories.";
  } else if (changes.data === undefined) {
    message = changes.isError ? `Couldn't load: ${changes.error.message}` : "Loading changes…";
  } else if (commit !== undefined) {
    if (groups.length === 0 && shown?.commit) message = `No changes in ${shortHash(commit)}.`;
  } else if (groups.length === 0) {
    message =
      compared && !sinceHead
        ? `No changes from ${revisionText(compared.from)} to ${revisionText(compared.to)}.`
        : "No changes.";
  }
  const { from: _, to: __, commit: ___, ...others } = params;
  // Since HEAD as no `from` and `to`: one address for it.
  const compare = (next: Compared) =>
    setParams(
      next.from === SINCE_HEAD.from && next.to === SINCE_HEAD.to ? others : { ...others, ...next },
    );
  const branch = changes.data?.branch;
  // A commit's changes, to compare other Revisions from: its first parent to it.
  const [parent] = shown?.commit?.parents ?? [];
  const ofCommit = parent && shown?.commit ? { from: parent, to: shown.commit.hash } : undefined;
  return (
    <section className={styles.view}>
      <ViewBar>
        {checkout && commit === undefined && (
          <ComparedPickers
            checkout={checkout}
            compared={picked}
            onChange={compare}
            known={branch ? { head: branch.head, branch: branch.branch, refs: [] } : undefined}
          />
        )}
        {checkout && shown && (
          <CommitLine
            shown={shown}
            checkout={checkout}
            open={details}
            onToggle={() => setDetails(!details)}
            onCompare={ofCommit && (() => compare(ofCommit))}
          />
        )}
        {checkout && (
          <BarEnd>
            {commit === undefined && sinceHead && (
              <Choice
                label="Groups"
                on={look.grouped}
                onChange={(on) => setLook({ ...look, grouped: on })}
                ways={[
                  {
                    icon: LayoutList,
                    title:
                      "Show changes grouped like `git status`: staged, not staged, untracked, unmerged",
                  },
                  {
                    icon: List,
                    title: "Show all changes since the last commit in one list, each file once",
                  },
                ]}
              />
            )}
            <NestedChoice />
            <ViewLink
              address={{
                kind: "diff",
                params: { ...checkout, ...(commit === undefined ? picked : { commit }) },
              }}
              label="These changes as one Diff"
              quiet={changes.data !== undefined && groups.length === 0}
            />
            <ViewLink
              address={{ kind: "history", params: checkout }}
              label="Commit history of this Checkout"
            />
            <Refresh
              busy={changes.isFetching}
              onClick={() => void client.invalidateQueries({ queryKey: KEYS.changes })}
            />
          </BarEnd>
        )}
      </ViewBar>
      {shown && checkout && (
        <CommitBelow shown={shown} checkout={checkout} now={now} open={details} />
      )}
      <ListTable
        table={table}
        className={`${styles.changes} ${styles.columns}`}
        oneLine
        choices={{}}
        message={message}
        stale={changes.isError || changes.isPlaceholderData}
        older="changes"
        detailsLabel="Details"
        details={() => null}
        folds={folds}
        plain={(entry) => !folds(entry)}
        opens={opens}
        showing={showing}
      />
    </section>
  );
}

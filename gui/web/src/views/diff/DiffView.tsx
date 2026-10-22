import { useQueryClient } from "@tanstack/react-query";
import { useAtom } from "@tanstack/react-store";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  ListChevronsDownUp,
  ListChevronsUpDown,
  StretchHorizontal,
  StretchVertical,
  TableOfContents,
  TextWrap,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Schemas } from "../../api/client";
import {
  type ChangesQuery,
  type DiffQuery,
  KEYS,
  useChanges,
  useDiff,
  useRepositories,
  useSetting,
} from "../../api/queries";
import { LazyDiffScroll } from "../../components/diff/LazyDiff";
import { codeThemes } from "../../components/diff/themes";
import { BarEnd, Choice, Refresh, ViewBar } from "../../components/ViewBar";
import { INDEX, revisionText, shortHash, WORKING_TREE } from "../../revisions";
import { useNow } from "../../useNow";
import { type Params, paramValues } from "../address";
import { Gone, isGone, LoadNote, useKeptError } from "../CheckoutError";
import { ComparedPickers } from "../changes/ComparedPickers";
import { checkoutName, checkoutOf } from "../changes/checkout";
import { foldedBy, unfolding, useFolds } from "../changes/folds";
import { changesLook, NestedChoice } from "../changes/look";
import {
  arrowText,
  type Compared,
  comparison,
  groupName,
  isFolder,
  pathParts,
} from "../changes/rows";
import { CommitBelow, CommitLine } from "../history/CommitHeader";
import type { ViewProps } from "../index";
import { useTitle } from "../title";
import { ViewLink } from "../ViewLink";
import styles from "./DiffView.module.css";
import { type DiffShow, FileSection } from "./FileSection";
import { diffLook } from "./look";
import { StackedDiff } from "./StackedDiff";

const NARROW = 48; // rem: below, a diff shows inline, as side by side its lines would be cut

/** Two revisions compared, in words where git's status has them: `staged`. */
export function comparedText(compared: Compared): string {
  const { from, to } = compared;
  if (from === "HEAD" && to === INDEX) return "staged";
  if (from === INDEX && to === WORKING_TREE) return "not staged";
  if (from === "HEAD" && to === WORKING_TREE) return "since HEAD";
  return arrowText(compared);
}

/** That there are no changes so: `No staged changes.`, `No changes from main to HEAD.` */
function noChanges(compared: Compared): string {
  const text = comparedText(compared);
  if (text === "staged") return "No staged changes.";
  if (text === "not staged") return "No unstaged changes.";
  return text.includes("→")
    ? `No changes from ${revisionText(compared.from)} to ${revisionText(compared.to)}.`
    : `No changes ${text}.`;
}

/** The file's diff the parameters name: its Checkout, what is compared (a commit against its
 * first parent, or two revisions), and its path. */
function diffQuery(params: Params): DiffQuery | undefined {
  const checkout = checkoutOf(params);
  const [commit] = paramValues(params.commit);
  const compared = commit === undefined ? comparison(params) : { commit };
  const [path] = paramValues(params.path);
  if (checkout === undefined || compared === undefined || path === undefined) return undefined;
  return { ...checkout, ...compared, path };
}

/** The two revisions a query compares, unless it is a commit's. */
function revisionsOf({ from, to }: DiffQuery): Compared | undefined {
  return from && to ? { from, to } : undefined;
}

/** What a query compares, in words: `staged`, or a commit's short hash. */
function queryText(query: DiffQuery): string {
  const revisions = revisionsOf(query);
  return revisions ? comparedText(revisions) : shortHash(query.commit ?? "");
}

/** Whether the element is narrower than `rem`; false until measured. Hidden, e.g. in a tab not
 * shown, it is 0 wide: as it was, rather than all its diffs drawn anew, inline, and back. */
function useNarrow(element: React.RefObject<HTMLElement | null>, rem: number): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (element.current === null) return;
    const em = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined && entry.contentRect.width > 0) {
        setNarrow(entry.contentRect.width < rem * em);
      }
    });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [element, rem]);
  return narrow;
}

/**
 * The diffs of a comparison from one Revision to another (its parameters `from` and `to`, picked
 * in its bar), or of a commit (`commit`, its line in the bar instead), as git's patch has them,
 * highlighted: one file's (`path`), or all, one under the other, each asked for as it comes near.
 * More of a file shows on asking. Large diffs wait to be shown; untracked files, to be opened;
 * one file without changes says where its changes are now.
 */
export function DiffView({ params, setParams, setTitle }: ViewProps) {
  const checkout = checkoutOf(params);
  const [commit] = paramValues(params.commit);
  const [path] = paramValues(params.path);
  const query = diffQuery(params);
  const compared = commit === undefined ? comparison(params) : undefined;
  const base = checkout && (commit === undefined ? compared : { commit });
  // All files' changes, for the stack; a commit's file, for the commit's line.
  const listQuery: ChangesQuery =
    checkout === undefined || base === undefined || (path !== undefined && commit === undefined)
      ? {}
      : { ...checkout, ...base, ...(path !== undefined && { path }) };
  const listed = useChanges(listQuery);
  const error = useKeptError(listed, listQuery);
  // One file's diff, as its section asks for it: also says whether the Checkout is gone.
  const fileQuery = path === undefined ? undefined : query;
  const fileError = useKeptError(useDiff(fileQuery), fileQuery);
  const gone = [error, fileError].find(isGone);
  const shown = commit === undefined ? undefined : listed.data?.commit;
  const [details, setDetails] = useState(false);
  const now = useNow(10_000);
  const { from: _, to: __, commit: ___, ...others } = params;
  const compare = (next: Compared) => setParams({ ...others, ...next });
  const [parent] = shown?.commit?.parents ?? [];
  const parentToCommit =
    parent && shown?.commit ? { from: parent, to: shown.commit.hash } : undefined;
  const client = useQueryClient();
  const repositories = useRepositories();
  const [look, setLook] = useAtom(diffLook());
  const [{ nested }] = useAtom(changesLook());
  const view = useRef<HTMLElement>(null);
  const narrow = useNarrow(view, NARROW);
  const [themes, unknown] = codeThemes({
    light: textSetting(useSetting("gui.code.theme_light")),
    dark: textSetting(useSetting("gui.code.theme_dark")),
  });
  const large = useSetting("gui.diff.large_lines");
  const show: DiffShow = {
    look: { ...look, split: look.split && !narrow },
    themes,
    large: typeof large === "number" ? large : undefined,
  };
  const what = commit !== undefined ? shortHash(commit) : compared && comparedText(compared);
  const name = checkout && checkoutName(repositories.data, checkout);
  const title = query
    ? `Diff: ${pathParts(query.path)[1]}, ${queryText(query)}`
    : name && what && `Diff: ${name}, ${what}`;
  useTitle(setTitle, title);
  const groups = path === undefined ? (listed.data?.groups ?? []) : [];
  // Files and directories (their paths ending in `/`) collapsed in the Checkout's stacks, in
  // every comparison; a directory's files keep theirs. All files, to collapse at once: not
  // untracked ones, which are listed.
  const [folded, setFolded] = useFolds("diff", checkout);
  const of = JSON.stringify(listQuery);
  const stackedFiles = groups
    .flatMap((group) => group.changes)
    .filter((change) => change.status !== "?" && !isFolder(change))
    .map((change) => change.path);
  const hidden = stackedFiles.filter((file) => foldedBy(folded.paths, file) !== undefined);

  let body: ReactNode;
  if (checkout === undefined || base === undefined) {
    body = <p className={styles.note}>Nothing compared: open a Diff from Changes.</p>;
  } else if (query !== undefined) {
    const revisions = revisionsOf(query);
    body = (
      <FileSection
        alone
        query={query}
        show={show}
        unchanged={
          revisions ? (
            <Unchanged query={{ ...query, ...revisions }} params={params} setParams={setParams} />
          ) : (
            <p className={styles.note}>No changes to this file in {queryText(query)}.</p>
          )
        }
      />
    );
  } else if (listed.data === undefined) {
    // An error: above it.
    body = error ? null : <p className={styles.note}>Loading changes…</p>;
  } else if (groups.length === 0) {
    body = (
      <p className={styles.note}>
        {compared ? noChanges(compared) : `No changes in ${shortHash(commit ?? "")}.`}
      </p>
    );
  } else {
    body = (
      <StackedDiff
        key={of} // untracked files opened for this comparison only
        groups={groups}
        query={listQuery}
        base={{ ...checkout, ...base }}
        show={show}
        nested={nested}
        folded={folded}
        onFoldedChange={setFolded}
      />
    );
  }

  const choose = (key: keyof typeof look) => (on: boolean) => setLook({ ...look, [key]: on });
  if (gone) {
    return (
      <section ref={view} className={styles.view}>
        <Gone error={gone} />
      </section>
    );
  }
  const stale = error !== null || listed.isPlaceholderData;
  return (
    <section ref={view} className={styles.view} data-stale={stale || undefined}>
      <ViewBar>
        {checkout && compared && (
          <ComparedPickers checkout={checkout} compared={compared} onChange={compare} />
        )}
        {checkout && shown && (
          <CommitLine
            shown={shown}
            checkout={checkout}
            open={details}
            onToggle={() => setDetails(!details)}
            onCompare={parentToCommit && (() => compare(parentToCommit))}
          />
        )}
        <BarEnd>
          <Choice
            label="Side by side"
            on={look.split && !narrow}
            onChange={choose("split")}
            ways={[
              {
                icon: StretchVertical,
                title: narrow
                  ? "Show old and new side by side, once the Panel is wide enough"
                  : "Show old and new side by side",
              },
              { icon: StretchHorizontal, title: "Show old and new inline" },
            ]}
          />
          <Choice
            label="Wrap"
            on={look.wrap}
            onChange={choose("wrap")}
            ways={[
              { icon: TextWrap, title: "Wrap long lines" },
              { icon: TableOfContents, title: "Scroll long lines" },
            ]}
          />
          <Choice
            label="Whole file"
            on={look.whole}
            onChange={choose("whole")}
            ways={[
              { icon: ListChevronsUpDown, title: "Show complete files" },
              { icon: ListChevronsDownUp, title: "Show context around changes only" },
            ]}
          />
          {/* All files: collapsed at once, to their headers; in Changes' order, which
              directories nested change. */}
          {!query && stackedFiles.length > 0 && (
            <Choice
              label="All files collapsed"
              on={
                hidden.length === stackedFiles.length
                  ? true
                  : hidden.length === 0
                    ? false
                    : undefined
              }
              onChange={(on) =>
                setFolded({
                  ...folded,
                  paths: on
                    ? new Set([...folded.paths, ...stackedFiles])
                    : unfolding(folded.paths, stackedFiles),
                })
              }
              ways={[
                { icon: ChevronsDownUp, title: "Collapse all files to their headers" },
                { icon: ChevronsUpDown, title: "Expand all files and directories" },
              ]}
            />
          )}
          {!query && <NestedChoice />}
          {/* One file: all files compared so, and its history; all files: the same links as
              Changes has, the other way to see them, and the Checkout's history. */}
          {query && checkout && base && (
            <>
              <ViewLink
                address={{ kind: "diff", params: { ...checkout, ...base } }}
                label="All changed files as one Diff"
              />
              <ViewLink
                address={{ kind: "history", params: { ...checkout, path: query.path } }}
                label={`Commit history of ${query.path}`}
              />
            </>
          )}
          {!query && checkout && base && (
            <>
              <ViewLink
                address={{ kind: "changes", params: { ...checkout, ...base } }}
                label="These changes as a list"
              />
              <ViewLink
                address={{ kind: "history", params: checkout }}
                label="Commit history of this Checkout"
              />
            </>
          )}
          <Refresh
            busy={listed.isFetching}
            onClick={() =>
              void client.invalidateQueries({ queryKey: query ? KEYS.diff : KEYS.changes })
            }
          />
        </BarEnd>
      </ViewBar>
      {shown && checkout && (
        <CommitBelow shown={shown} checkout={checkout} now={now} open={details} />
      )}
      {unknown.length > 0 && (
        <p className={styles.note}>
          Unknown code theme {unknown.join(", ")}: the default shows instead. The settings{" "}
          <code>gui.code.theme_light</code> and <code>gui.code.theme_dark</code> name themes as
          Shiki does.
        </p>
      )}
      {error && <LoadNote error={error} />}
      <LazyDiffScroll className={styles.diff} themes={themes}>
        {body}
      </LazyDiffScroll>
    </section>
  );
}

function textSetting(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

interface UnchangedProps {
  query: DiffQuery & Compared;
  params: Params;
  setParams: (params: Params) => void;
}

/** A file without changes compared so: where its changes are now, to show them instead. */
function Unchanged({ query, params, setParams }: UnchangedProps) {
  const { from: _, to: __, path, ...checkout } = query;
  const now = useChanges({ ...checkout, path });
  if (now.data === undefined) {
    return <p className={styles.note}>{noChanges(query)}</p>;
  }
  const groups = now.data.groups.filter((group) =>
    group.changes.some((change) => change.path === path),
  );
  const options: [string, Compared][] = groups.map((group: Schemas["ChangeGroupJson"]) => [
    groupName(group),
    { from: group.from, to: group.to },
  ]);
  if (groups.length > 0) options.push(["Since HEAD", { from: "HEAD", to: WORKING_TREE }]);
  const offered = options.filter(
    ([, compared], index) =>
      !(compared.from === query.from && compared.to === query.to) &&
      options.findIndex(([, other]) => other.from === compared.from && other.to === compared.to) ===
        index,
  );
  return (
    <p className={styles.note}>
      {noChanges(query)}{" "}
      {offered.length > 0 ? "The changes are now in:" : "Nothing left: committed or undone."}{" "}
      {offered.map(([name, compared]) => (
        <button
          key={name}
          type="button"
          className={styles.action}
          onClick={() => setParams({ ...params, ...compared })}
        >
          {name}
        </button>
      ))}
    </p>
  );
}

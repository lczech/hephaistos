import { useQueryClient } from "@tanstack/react-query";
import { useAtom } from "@tanstack/react-store";
import {
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
  useRepositories,
  useSetting,
} from "../../api/queries";
import { LazyDiffScroll } from "../../components/diff/LazyDiff";
import { codeThemes } from "../../components/diff/themes";
import { BarEnd, BarLine, Choice, Refresh, ViewBar } from "../../components/ViewBar";
import { INDEX, revisionText, shortHash, WORKING_TREE } from "../../revisions";
import { useNow } from "../../useNow";
import { type Params, paramValues } from "../address";
import { ComparedPickers } from "../changes/ComparedPickers";
import { checkoutName, checkoutOf } from "../changes/checkout";
import {
  arrowText,
  type Compared,
  comparison,
  groupName,
  pathParts,
  totalsText,
} from "../changes/rows";
import { CommitBelow, CommitLine } from "../history/CommitHeader";
import type { ViewProps } from "../index";
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

/** Whether the element is narrower than `rem`; false until measured. */
function useNarrow(element: React.RefObject<HTMLElement | null>, rem: number): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (element.current === null) return;
    const em = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setNarrow(entry.contentRect.width < rem * em);
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
  useEffect(() => {
    if (title !== undefined) setTitle(title);
  }, [title, setTitle]);
  const groups = path === undefined ? (listed.data?.groups ?? []) : [];

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
    body = (
      <p className={styles.note}>
        {listed.isError ? `Couldn't load: ${listed.error.message}` : "Loading changes…"}
      </p>
    );
  } else if (groups.length === 0) {
    body = (
      <p className={styles.note}>
        {compared ? noChanges(compared) : `No changes in ${shortHash(commit ?? "")}.`}
      </p>
    );
  } else {
    body = (
      <StackedDiff
        key={JSON.stringify(listQuery)} // files collapsed for this comparison only
        groups={groups}
        query={listQuery}
        base={{ ...checkout, ...base }}
        show={show}
      />
    );
  }

  const choose = (key: keyof typeof look) => (on: boolean) => setLook({ ...look, [key]: on });
  return (
    <section ref={view} className={styles.view} data-stale={listed.isPlaceholderData || undefined}>
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
        {groups.length > 0 && (
          <BarLine>
            <span title="Total lines added and removed">
              {totalsText(groups.flatMap((group) => group.changes))}
            </span>
          </BarLine>
        )}
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
      <LazyDiffScroll className={styles.diff}>{body}</LazyDiffScroll>
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

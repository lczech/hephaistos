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
  type DiffQuery,
  KEYS,
  useChanges,
  useDiff,
  useDiffFiles,
  useSetting,
} from "../../api/queries";
import { LazyDiff } from "../../components/diff/LazyDiff";
import { codeThemes } from "../../components/diff/themes";
import { BarEnd, Choice, Refresh, ViewBar } from "../../components/ViewBar";
import { INDEX, revisionText, shortHash, WORKING_TREE } from "../../revisions";
import { useNow } from "../../useNow";
import { type Params, paramValues } from "../address";
import { ComparedPickers } from "../changes/ComparedPickers";
import { checkoutOf } from "../changes/checkout";
import { ChangePath, Lines } from "../changes/columns";
import {
  arrowText,
  type Change,
  type Compared,
  changedLines,
  comparison,
  groupName,
  otherText,
  pathParts,
} from "../changes/rows";
import { CommitBelow, CommitLine } from "../history/CommitHeader";
import type { ViewProps } from "../index";
import { ViewLink } from "../ViewLink";
import styles from "./DiffView.module.css";
import { diffLook } from "./look";

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
 * A file's diff from one Revision to another (its parameters `from` and `to`, picked in its
 * bar), or in a commit (`commit`, its line in the bar instead), as git's patch has it,
 * highlighted. More of the file shows on asking. Large diffs wait to be shown; one that is empty
 * says where the file's changes are now.
 */
export function DiffView({ params, setParams, setTitle }: ViewProps) {
  const query = diffQuery(params);
  const diff = useDiff(query);
  const checkout = checkoutOf(params);
  const [commit] = paramValues(params.commit);
  // A commit's, for its line: the file's changes in it, with all about the commit.
  const ofCommit = useChanges(
    checkout && query && commit !== undefined ? { ...checkout, commit, path: query.path } : {},
  );
  const shown = commit === undefined ? undefined : ofCommit.data?.commit;
  const [details, setDetails] = useState(false);
  const now = useNow(10_000);
  const { from: _, to: __, commit: ___, ...others } = params;
  const compare = (next: Compared) => setParams({ ...others, ...next });
  const [parent] = shown?.commit?.parents ?? [];
  const parentToCommit =
    parent && shown?.commit ? { from: parent, to: shown.commit.hash } : undefined;
  const client = useQueryClient();
  const [look, setLook] = useAtom(diffLook());
  const view = useRef<HTMLElement>(null);
  const narrow = useNarrow(view, NARROW);
  const [shownLarge, setShownLarge] = useState<string>();
  const [themes, unknown] = codeThemes({
    light: textSetting(useSetting("gui.code.theme_light")),
    dark: textSetting(useSetting("gui.code.theme_dark")),
  });
  const large = useSetting("gui.diff.large_lines");

  const title = query && `Diff: ${pathParts(query.path)[1]}, ${queryText(query)}`;
  useEffect(() => {
    if (title !== undefined) setTitle(title);
  }, [title, setTitle]);

  const change = diff.data?.change;
  const patch = diff.data?.patch;
  const waiting =
    typeof large === "number" &&
    (change ? (changedLines(change) ?? 0) : 0) > large &&
    shownLarge !== query?.path;
  // Both versions, where both are and the patch shows; an added or deleted file is all patch.
  const twoSided = change && !change.binary && !["A", "?", "D"].includes(change.status);
  const versions = useDiffFiles(
    query,
    diff.dataUpdatedAt,
    Boolean(twoSided && patch && !waiting && !diff.isPlaceholderData),
  );

  let body: ReactNode;
  if (query === undefined) {
    body = <p className={styles.note}>No file: open a Diff from a file in Changes.</p>;
  } else if (diff.data === undefined) {
    body = (
      <p className={styles.note}>
        {diff.isError ? `Couldn't load: ${diff.error.message}` : "Loading the diff…"}
      </p>
    );
  } else if (change === null || change === undefined) {
    const revisions = revisionsOf(query);
    body = revisions ? (
      <Unchanged query={{ ...query, ...revisions }} params={params} setParams={setParams} />
    ) : (
      <p className={styles.note}>No changes to this file in {queryText(query)}.</p>
    );
  } else if (change.binary) {
    body = <p className={styles.note}>Not shown: {otherText(change)}.</p>;
  } else if (patch === null || patch === undefined) {
    const size = otherText(change);
    body = (
      <p className={styles.note}>
        Not shown{size ? `: ${size}` : ""}, more than the setting <code>gui.diff.max_bytes</code>{" "}
        allows.
      </p>
    );
  } else if (waiting) {
    body = (
      <p className={styles.note}>
        {(changedLines(change) ?? 0).toLocaleString("en")} lines changed: more than the setting{" "}
        <code>gui.diff.large_lines</code>.{" "}
        <button type="button" className={styles.action} onClick={() => setShownLarge(query.path)}>
          Show
        </button>
      </p>
    );
  } else {
    body = (
      <LazyDiff
        patch={patch}
        header={<FileHeader change={change} />}
        look={{ ...look, split: look.split && !narrow }}
        themes={themes}
        versions={versions.data}
      />
    );
  }

  const choose = (key: keyof typeof look) => (on: boolean) => setLook({ ...look, [key]: on });
  return (
    <section ref={view} className={styles.view} data-stale={diff.isPlaceholderData || undefined}>
      <ViewBar>
        {checkout && query?.from && query.to && (
          <ComparedPickers
            checkout={checkout}
            compared={{ from: query.from, to: query.to }}
            onChange={compare}
          />
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
              { icon: ListChevronsUpDown, title: "Show complete file" },
              { icon: ListChevronsDownUp, title: "Show context around changes only" },
            ]}
          />
          {query && (
            <ViewLink
              address={{ kind: "history", params: { ...checkoutOf(params), path: query.path } }}
              label={`Commit history of ${query.path}`}
              opening={{ beside: true, preview: true }}
            />
          )}
          <Refresh
            busy={diff.isFetching}
            onClick={() => void client.invalidateQueries({ queryKey: KEYS.diff })}
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
      <div className={styles.diff}>{body}</div>
    </section>
  );
}

/**
 * Above the diff: what happened to the file, its path, and its lines added and removed; what is
 * compared, the bar says.
 */
function FileHeader({ change }: { change: Change }) {
  return (
    <div className={styles.header}>
      <ChangePath change={change} base="" />
      {change.original !== null && (
        <span className={styles.aside}>renamed from {change.original}</span>
      )}
      {change.added !== null && change.removed !== null && (
        <Lines added={change.added} removed={change.removed} />
      )}
    </div>
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

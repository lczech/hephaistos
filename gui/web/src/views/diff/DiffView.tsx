import { useQueryClient } from "@tanstack/react-query";
import { useAtom } from "@tanstack/react-store";
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
import { BarEnd, Refresh, Toggle, ViewBar } from "../../components/ViewBar";
import { type Params, paramValues } from "../address";
import { checkoutOf } from "../changes/checkout";
import { ChangePath, Lines } from "../changes/columns";
import {
  type Change,
  changedLines,
  comparison,
  groupName,
  otherText,
  pathParts,
} from "../changes/rows";
import { shortHash } from "../history/rows";
import type { ViewProps } from "../index";
import { ViewLink } from "../ViewLink";
import styles from "./DiffView.module.css";
import { diffLook } from "./look";

type Compared = { from: string; to: string };

const NARROW = 48; // rem: below, a diff shows inline, as side by side its lines would be cut

/** What two states compared are, in words where git's status has them: `staged`. */
export function comparedText({ from, to }: Compared): string {
  if (from === "HEAD" && to === "index") return "staged";
  if (from === "index" && to === "worktree") return "not staged";
  if (from === "HEAD" && to === "worktree") return "since HEAD";
  return `${from} → ${to}`;
}

/** That there are no changes so: `No changes staged.`, `No changes from main to HEAD.` */
function noChanges(compared: Compared): string {
  const text = comparedText(compared);
  return text.includes("→")
    ? `No changes from ${compared.from} to ${compared.to}.`
    : `No changes ${text}.`;
}

/** The file's diff the parameters name: its Checkout, what is compared (a commit against its
 * first parent, or two states), and its path. */
function diffQuery(params: Params): DiffQuery | undefined {
  const checkout = checkoutOf(params);
  const [commit] = paramValues(params.commit);
  const compared = commit === undefined ? comparison(params) : { commit };
  const [path] = paramValues(params.path);
  if (checkout === undefined || compared === undefined || path === undefined) return undefined;
  return { ...checkout, ...compared, path };
}

/** The two states a query compares, unless it is a commit's. */
function statesOf({ from, to }: DiffQuery): Compared | undefined {
  return from && to ? { from, to } : undefined;
}

/** What a query compares, in words: `staged`, or a commit's short hash. */
function queryText(query: DiffQuery): string {
  const states = statesOf(query);
  return states ? comparedText(states) : shortHash(query.commit ?? "");
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
 * A file's diff from one state to another (its parameters `from` and `to`: a commit, `index`
 * or `worktree`), as git's patch has it, highlighted. More of the file shows on asking. Large
 * diffs wait to be shown; one that is empty says where the file's changes are now.
 */
export function DiffView({ params, setParams, setTitle }: ViewProps) {
  const query = diffQuery(params);
  const diff = useDiff(query);
  const versions = useDiffFiles(query);
  const client = useQueryClient();
  const [look, setLook] = useAtom(diffLook());
  const view = useRef<HTMLElement>(null);
  const narrow = useNarrow(view, NARROW);
  const [shownLarge, setShownLarge] = useState<string>();
  const [themes, unknown] = codeThemes({
    light: textSetting(useSetting("gui.code_theme_light")),
    dark: textSetting(useSetting("gui.code_theme_dark")),
  });
  const large = useSetting("gui.diff.large_lines");

  const title = query && `Diff: ${pathParts(query.path)[1]}, ${queryText(query)}`;
  useEffect(() => {
    if (title !== undefined) setTitle(title);
  }, [title, setTitle]);

  let body: ReactNode;
  const change = diff.data?.change;
  const patch = diff.data?.patch;
  if (query === undefined) {
    body = <p className={styles.note}>No file: open a Diff from a file in Changes.</p>;
  } else if (diff.data === undefined) {
    body = (
      <p className={styles.note}>
        {diff.isError ? `No answer: ${diff.error.message}` : "Asking git…"}
      </p>
    );
  } else if (change === null || change === undefined) {
    const states = statesOf(query);
    body = states ? (
      <Unchanged query={{ ...query, ...states }} params={params} setParams={setParams} />
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
  } else if (
    typeof large === "number" &&
    (changedLines(change) ?? 0) > large &&
    shownLarge !== query.path
  ) {
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
        header={<FileHeader change={change} compared={queryText(query)} />}
        look={{ ...look, split: look.split && !narrow }}
        themes={themes}
        versions={versions}
      />
    );
  }

  const choose = (key: keyof typeof look) => (on: boolean) => setLook({ ...look, [key]: on });
  return (
    <section ref={view} className={styles.view} data-stale={diff.isPlaceholderData || undefined}>
      <ViewBar>
        <Toggle
          on={look.split && !narrow}
          onChange={choose("split")}
          title={
            narrow
              ? "Side by side where the Panel is wide enough; inline here"
              : "Old and new side by side; else inline, one above the other"
          }
        >
          Side by side
        </Toggle>
        <Toggle on={look.wrap} onChange={choose("wrap")} title="Wrap long lines; else scroll them">
          Wrap
        </Toggle>
        <Toggle
          on={look.whole}
          onChange={choose("whole")}
          title="All of the file around its changes; else only some lines, which buttons show more of"
        >
          Whole file
        </Toggle>
        <BarEnd>
          {query && (
            <ViewLink
              address={{ kind: "history", params: { ...checkoutOf(params), path: query.path } }}
              label={`History of ${query.path}: the commits that changed it`}
              opening={{ beside: true, preview: true }}
            />
          )}
          <Refresh
            busy={diff.isFetching}
            onClick={() => void client.invalidateQueries({ queryKey: KEYS.diff })}
          />
        </BarEnd>
      </ViewBar>
      {unknown.length > 0 && (
        <p className={styles.note}>
          Unknown code theme {unknown.join(", ")}: the default shows instead. The settings{" "}
          <code>gui.code_theme_light</code> and <code>gui.code_theme_dark</code> name themes as
          Shiki does.
        </p>
      )}
      <div className={styles.diff}>{body}</div>
    </section>
  );
}

/**
 * Above the diff: what happened to the file, its path, the states compared, and its lines added
 * and removed.
 */
function FileHeader({ change, compared }: { change: Change; compared: string }) {
  return (
    <div className={styles.header}>
      <ChangePath change={change} base="" />
      {change.original !== null && (
        <span className={styles.aside}>renamed from {change.original}</span>
      )}
      <span className={styles.aside}>{compared}</span>
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
  if (groups.length > 0) options.push(["Since HEAD", { from: "HEAD", to: "worktree" }]);
  const offered = options.filter(
    ([, compared], index) =>
      !(compared.from === query.from && compared.to === query.to) &&
      options.findIndex(([, other]) => other.from === compared.from && other.to === compared.to) ===
        index,
  );
  return (
    <p className={styles.note}>
      {noChanges(query)}{" "}
      {offered.length > 0 ? "Its changes are now:" : "None left: committed, or undone."}{" "}
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

import { ChevronRight } from "lucide-react";
import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type DiffQuery, useDiff, useDiffFiles } from "../../api/queries";
import type { DiffLook, Versions } from "../../components/diff/Diff";
import { type DiffRows, diffRows, lineCount } from "../../components/diff/height";
import { LazyDiff } from "../../components/diff/LazyDiff";
import { useDiffScroller } from "../../components/diff/scroller";
import type { CodeThemes } from "../../components/diff/themes";
import type { Params } from "../address";
import { LoadNote } from "../CheckoutError";
import { ChangePath, DirectoryPath, Lines } from "../changes/columns";
import {
  type Change,
  changedLines,
  type Entry,
  isFolder,
  otherText,
  totals,
} from "../changes/rows";
import { ViewLink } from "../ViewLink";
import styles from "./DiffView.module.css";
import type { FileFind } from "./diffFind";

/** How the diffs show, the same for all files: the bar's choices, the code's themes. */
export interface DiffShow {
  look: DiffLook;
  themes: CodeThemes;
  large: number | undefined; // lines changed above which a diff waits to be shown
}

const AHEAD = "1500px"; // how far beyond the scrolled area a diff is asked for

/** A height for CSS to size, as `.waiting` and `.holding` do. */
function heightOf({ rows, separators, ends }: DiffRows): CSSProperties {
  return { "--rows": rows, "--separators": separators, "--ends": ends } as CSSProperties;
}

/** A diff's rows and separators, guessed from its lines changed until its patch is there: a few
 * lines around its changes, a separator or two. */
function guessed(change: Change | undefined, show: DiffShow): DiffRows {
  const { added, removed } = change ?? { added: 0, removed: 0 };
  const changed = show.look.split
    ? Math.max(added ?? 0, removed ?? 0)
    : (added ?? 0) + (removed ?? 0);
  return { rows: Math.min(changed, show.large ?? changed) + 6, separators: 2, ends: 0 };
}

/** Whether the element has come near the scrolled area, once; then stays so. */
function useNear(element: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [near, setNear] = useState(false);
  const scroller = useDiffScroller();
  useEffect(() => {
    if (!enabled || near || element.current === null) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { root: scroller(), rootMargin: `${AHEAD} 0px` },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [element, enabled, near, scroller]);
  return near;
}

interface BodyProps {
  query: DiffQuery;
  known?: Change; // the file's change as a list has it, before its diff is asked for
  show: DiffShow;
  unchanged?: ReactNode; // what to say if the file has no changes so; by default that
  estimate?: CSSProperties; // as one of many: its height, guessed, until it is drawn
  find?: FileFind; // matches to mark in it
}

/**
 * A file's diff as git's patch has it, highlighted; more of the file on asking. Binary files and
 * those too large say so; large diffs wait to be shown. Asked for once shown. A patch shows with
 * its versions, which say how much of the file follows its last change: a new patch, asked for
 * again, e.g. on focus, once they come too, so that the diff changes at most once.
 */
export function FileBody({ query, known, show, unchanged, estimate, find }: BodyProps) {
  const diff = useDiff(query);
  const [shownLarge, setShownLarge] = useState(false);
  // A large diff shows for good once a match found in it is stepped to, as if asked to.
  if (find?.revealed && !shownLarge) setShownLarge(true);
  const change = diff.data ? diff.data.change : known;
  const patch = diff.data?.patch;
  const waiting =
    show.large !== undefined &&
    (change ? (changedLines(change) ?? 0) : 0) > show.large &&
    !shownLarge;
  // Both versions, where both are and the patch shows; an added or deleted file is all patch.
  const twoSided = change && !change.binary && !["A", "?", "D"].includes(change.status);
  const due = Boolean(twoSided && patch && !waiting && !diff.isPlaceholderData);
  const versions = useDiffFiles(query, diff.dataUpdatedAt, due);
  // The patch shown and its versions: kept until a new patch's versions came too.
  const [shown, setShown] = useState<{ patch: string; versions: Versions | undefined }>();
  const asking = estimate ? (
    <div className={styles.waiting} style={estimate} />
  ) : (
    <p className={styles.note}>Loading the diff…</p>
  );
  if (diff.data === undefined) {
    return diff.isError ? <LoadNote error={diff.error} /> : asking;
  }
  if (change === null || change === undefined) {
    return unchanged ?? <p className={styles.note}>No changes to this file so, now.</p>;
  }
  if (change.binary) return <p className={styles.note}>Not shown: {otherText(change)}.</p>;
  if (patch === null || patch === undefined) {
    const size = otherText(change);
    return (
      <p className={styles.note}>
        Not shown{size ? `: ${size}` : ""}, more than the setting <code>gui.diff.max_bytes</code>{" "}
        allows.
      </p>
    );
  }
  if (waiting) {
    return (
      <p className={styles.note}>
        {(changedLines(change) ?? 0).toLocaleString("en")} lines changed: more than the setting{" "}
        <code>gui.diff.large_lines</code>.{" "}
        <button type="button" className={styles.action} onClick={() => setShownLarge(true)}>
          Show
        </button>
      </p>
    );
  }
  // This patch with its versions, once they came (or can't), else the patch shown before; kept
  // as React keeps what a render showed, set while rendering.
  const ready =
    !due || versions.data !== undefined || versions.isError
      ? { patch, versions: due ? versions.data : undefined }
      : undefined;
  if (ready && (ready.patch !== shown?.patch || ready.versions !== shown?.versions)) {
    setShown(ready);
  }
  const pair = ready ?? shown;
  if (pair === undefined) return asking;
  // Its height as the patch has it, held until the renderer has drawn it.
  const newText = pair.versions?.new;
  const held = heightOf(
    diffRows(pair.patch, show.look, typeof newText === "string" ? lineCount(newText) : undefined),
  );
  const rendered = (fallback?: ReactNode) => (
    <LazyDiff
      patch={pair.patch}
      look={show.look}
      themes={show.themes}
      versions={pair.versions}
      find={find}
      fallback={fallback}
    />
  );
  return estimate ? <Holding estimate={held}>{rendered(null)}</Holding> : rendered();
}

/**
 * Keeps the estimated height, at least, until what it holds has a height of its own: the
 * renderer draws a diff a moment after it is given, at first as nothing.
 */
function Holding({ estimate, children }: { estimate: CSSProperties; children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState(true);
  useEffect(() => {
    if (!held || content.current === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.height > 0) setHeld(false);
    });
    observer.observe(content.current);
    return () => observer.disconnect();
  }, [held]);
  return (
    <div className={held ? styles.holding : undefined} style={held ? estimate : undefined}>
      <div ref={content}>{children}</div>
    </div>
  );
}

interface SectionProps extends BodyProps {
  lazy?: boolean; // asks for the diff only once near the scrolled area, as one of many
  alone?: boolean; // the file's own Diff, so no link to it
  folded?: boolean; // only its header shown: one of many, folded by clicking its header
  onFoldedChange?: (folded: boolean) => void;
}

/**
 * A file's diff under its header, which stays in view while the diff scrolls: what happened to
 * the file, its path, its lines added and removed. One of many waits as high as its lines would
 * be, until near the scrolled area; and folds to its header, which stays where it is.
 */
export function FileSection({
  lazy = false,
  alone = false,
  folded = false,
  onFoldedChange,
  ...body
}: SectionProps) {
  const section = useRef<HTMLElement>(null);
  const near = useNear(section, lazy && !folded);
  const asked = !lazy || near;
  // The change once its diff came, as git has it now; the list's until then.
  const diff = useDiff(asked ? body.query : undefined);
  const change = diff.data ? (diff.data.change ?? undefined) : body.known;
  const waiting = heightOf(guessed(change, body.show));
  const toggle = useFolding(section, folded, onFoldedChange);
  // Brought near, so asked for and drawn, once a match found in it is the current one: its diff
  // then brings the match into view.
  const scroller = useDiffScroller();
  const current = body.find?.current;
  useEffect(() => {
    const element = section.current;
    const root = scroller();
    if (current === undefined || asked || element === null || root === undefined) return;
    const top = element.getBoundingClientRect().top - root.getBoundingClientRect().top;
    root.scrollTo({ top: root.scrollTop + top });
  }, [current, asked, scroller]);
  return (
    <section
      ref={section}
      className={styles.file}
      aria-label={body.query.path}
      data-folded={folded || undefined}
    >
      <FileHeader
        change={change}
        path={body.query.path}
        query={alone ? undefined : body.query}
        folded={folded}
        onToggle={toggle}
      />
      {folded ? null : asked ? (
        <FileBody {...body} estimate={lazy ? waiting : undefined} />
      ) : (
        <div className={styles.waiting} style={waiting} />
      )}
    </section>
  );
}

/**
 * How a section folds: a toggle, if it can. Folding one scrolled past its top keeps its
 * header where it was, stuck at the top.
 */
function useFolding(
  section: RefObject<HTMLElement | null>,
  folded: boolean,
  onFoldedChange: ((folded: boolean) => void) | undefined,
): (() => void) | undefined {
  const stuck = useRef(false);
  const scrollsIn = useDiffScroller();
  useLayoutEffect(() => {
    const element = section.current;
    if (!folded || !stuck.current || element === null) return;
    stuck.current = false;
    const scroller = scrollsIn();
    if (scroller === undefined) return;
    const past = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    // To the nearest whole pixel: WebKit scrolls by whole ones, dropping a fraction.
    scroller.scrollTop = Math.round(scroller.scrollTop + past);
  }, [section, folded, scrollsIn]);
  if (onFoldedChange === undefined) return undefined;
  return () => {
    const element = section.current;
    const scroller = scrollsIn();
    stuck.current = Boolean(
      element &&
        scroller &&
        element.getBoundingClientRect().top < scroller.getBoundingClientRect().top,
    );
    onFoldedChange(!folded);
  };
}

interface DirectoryProps {
  entry: Extract<Entry, { type: "directory" }>;
  folded: boolean;
  foldedWith?: string | undefined; // the directory above it whose fold folds it too
  onFoldedChange: (folded: boolean) => void;
  children: ReactNode; // its files' sections, and nested, its directories'
}

/**
 * A directory's files, nested its directories too, under its header, which stays in view above
 * theirs while they show: its path, how many files and lines changed. Folds to its header;
 * folded with a directory above it, it shows with that.
 */
export function DirectorySection({
  entry,
  folded,
  foldedWith,
  onFoldedChange,
  children,
}: DirectoryProps) {
  const section = useRef<HTMLElement>(null);
  const toggle = useFolding(section, folded, onFoldedChange);
  const files = entry.changes.filter((change) => !isFolder(change)).length;
  return (
    <section
      ref={section}
      className={styles.directory}
      aria-label={entry.path}
      data-folded={folded || undefined}
    >
      <FoldHeader
        className={styles.folder}
        label={`Files in ${entry.path}`}
        what={foldedWith ? `${foldedWith} and all in it` : "the files in this directory"}
        folded={folded}
        onToggle={toggle}
        end={
          <>
            {foldedWith && <span className={styles.aside}>folded with {foldedWith}</span>}
            <span className={styles.aside}>
              {files.toLocaleString("en")} {files === 1 ? "file" : "files"}
            </span>
            <Lines {...totals(entry.changes)} />
            <span className={styles.linkRoom} /> {/* as the files' links take */}
          </>
        }
      >
        <DirectoryPath shown={entry.path} path={entry.path} />
      </FoldHeader>
      {!folded && children}
    </section>
  );
}

/** A query's parameters that are set, as a View's. */
function defined(query: DiffQuery): Params {
  return Object.fromEntries(
    Object.entries(query).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

interface HeaderProps {
  change?: Change;
  path: string;
  query?: DiffQuery; // for a link to the file's own Diff
  folded: boolean;
  onToggle?: () => void; // folds or unfolds the diff, by the chevron or a click on the header
}

/**
 * Above a diff: what happened to the file, its path, its lines added and removed; for one of
 * many, a chevron that folds it, and a link to its own Diff. What is compared, the bar says.
 */
function FileHeader({ change, path, query, folded, onToggle }: HeaderProps) {
  return (
    <FoldHeader
      className={styles.header}
      label={`Diff of ${path}`}
      what="this file's diff"
      folded={folded}
      onToggle={onToggle}
      end={
        <>
          {change && change.added !== null && change.removed !== null && (
            <Lines added={change.added} removed={change.removed} />
          )}
          {query && (
            <ViewLink
              address={{ kind: "diff", params: defined(query) }}
              label={`Diff of ${path} alone`}
            />
          )}
        </>
      }
    >
      {change ? <ChangePath change={change} base="" /> : <span>{path}</span>}
      {change?.original != null && (
        <span className={styles.aside}>renamed from {change.original}</span>
      )}
    </FoldHeader>
  );
}

interface FoldHeaderProps {
  className: string | undefined;
  label: string; // its chevron's: `Diff of src/a.py`
  what: string; // what it folds: `this file's diff`
  folded: boolean;
  onToggle?: () => void; // folds or unfolds, by the chevron or a click on the header
  end: ReactNode; // at its end: numbers, links
  children: ReactNode; // what it is about
}

/** A header that folds what is below it: by its chevron, or a click anywhere else on it. */
function FoldHeader({ className, label, what, folded, onToggle, end, children }: FoldHeaderProps) {
  // Anywhere on the header but its links, and not a click ending a text selection.
  const click = (event: MouseEvent) => {
    if ((event.target as Element).closest("button, a")) return;
    if ((document.getSelection()?.toString() ?? "") !== "") return;
    onToggle?.();
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: a shortcut for the mouse; its chevron folds it by keyboard
    <div
      className={className}
      data-foldable={onToggle ? true : undefined}
      onClick={onToggle && click}
    >
      {onToggle && (
        <button
          type="button"
          className={styles.fold}
          aria-expanded={!folded}
          aria-label={label}
          title={folded ? `Unfold ${what}` : `Fold ${what}`}
          onClick={onToggle}
        >
          <ChevronRight aria-hidden="true" />
        </button>
      )}
      {children}
      <span className={styles.end}>{end}</span>
    </div>
  );
}

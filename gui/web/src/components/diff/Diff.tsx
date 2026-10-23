// The one module that knows the diff renderer, @pierre/diffs: the rest of the GUI gives it
// git's patch and options in its own terms, so that another renderer could take its place.
// Large, with its highlighter: loaded only once a diff shows (`LazyDiff`).

import {
  DEFAULT_VIRTUAL_FILE_METRICS,
  getSingularPatch,
  hydratePartialDiff,
  VirtualizedFileDiff,
} from "@pierre/diffs";
import type { FileDiffMetadata, SelectedLineRange, WorkerPoolOptions } from "@pierre/diffs/react";
import {
  FileDiff,
  useVirtualizer,
  useWorkerPool,
  Virtualizer,
  WorkerPoolContextProvider,
} from "@pierre/diffs/react";
import HighlightWorker from "@pierre/diffs/worker/worker.js?worker";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MARKS_LOOK, type Marked, markMatches, rangeIn } from "../find/marks";
import { DiffScrollerContext, useDiffScroller } from "./scroller";
import type { CodeThemes } from "./themes";

/** How a diff shows: side by side, long lines wrapped, the whole file around its changes. */
export interface DiffLook {
  split: boolean;
  wrap: boolean;
  whole: boolean;
}

/** A file's two versions; null where it doesn't exist. */
export interface Versions {
  old: string | null;
  new: string | null;
}

/** A match to mark: its line, by its numbers in the old and new versions, and where in it. */
export interface DiffMark {
  old: number | null;
  new: number | null;
  start: number; // UTF-16 offsets, as JS strings
  end: number;
  inPatch: boolean; // on one of the patch's lines, which always show
}

/** Matches found in a diff's lines: marked where drawn, the current one scrolled into view. */
export interface DiffFind {
  marks: readonly DiffMark[];
  current: DiffMark | undefined;
  /** Which marks are on lines shown, by their place, told as that changes: e.g. once collapsed
   * lines are expanded. */
  onShown: (shown: readonly number[]) => void;
}

interface Props {
  patch: string; // git's, for one file
  look: DiffLook;
  themes: CodeThemes;
  versions: Versions | undefined; // once known: to show where the file ends, and more of it
  find?: DiffFind;
}

// A line of code's height: the renderer's, and ours to hold diffs' places (`height.ts`).
const LINE_HEIGHT = "calc(var(--code-size) * 1.5)";

// The page's background under the code, whatever the theme's: the renderer mixes the colours
// of lines added and removed from it; and the code's font and size. The lines left out between
// changes as gaps between two lines, rather than bars: quieter than the files' headers. Matches
// found marked as elsewhere, the marks' look within the renderer's shadow root. The renderer's
// own variables and attributes, so check them on upgrades.
const PAGE_LOOK = `:host {
  --diffs-light-bg: var(--background);
  --diffs-dark-bg: var(--background);
  --diffs-bg-separator: var(--background);
  --diffs-font-family: var(--font-mono);
  --diffs-font-size: var(--code-size);
  --diffs-line-height: ${LINE_HEIGHT};
  --diffs-bg-selection-override: var(--accent);
  --diffs-bg-selection-number-override: var(--accent);
}
[data-separator=line-info] {
  box-shadow: inset 0 1px var(--line), inset 0 -1px var(--line);
}
[data-separator=line-info] [data-separator-wrapper],
[data-separator=line-info] [data-separator-content],
[data-separator=line-info] [data-expand-button] {
  background: none;
}
${MARKS_LOOK}`;

/** The patch's lines filled in with both versions, so that all of the file can show; the patch
 * alone where one is missing or the renderer refuses them. It doesn't check that they fit the
 * patch: they must be asked for after it. */
export function withVersions(partial: FileDiffMetadata, versions: Versions): FileDiffMetadata {
  if (versions.old === null || versions.new === null) return partial; // all in the patch
  const oldFile = { name: partial.prevName ?? partial.name, contents: versions.old };
  const newFile = { name: partial.name, contents: versions.new };
  try {
    return hydratePartialDiff("clone", partial, { oldFile, newFile });
  } catch {
    return partial;
  }
}

/**
 * A new or deleted file as a change: the renderer shows their lines across both sides when side
 * by side, so they would look unlike other files' lines added and removed, on their own side.
 */
export function bothSides(fileDiff: FileDiffMetadata): FileDiffMetadata {
  return fileDiff.type === "new" || fileDiff.type === "deleted"
    ? { ...fileDiff, type: "change" }
    : fileDiff;
}

// Highlighting in workers, so that the page stays responsive while large files are: a diff shows
// as plain text until its colours come. Half the cores, at most 4, each worker with a highlighter
// of its own; without workers (or if they fail to start), on the page, as before.
const POOL: WorkerPoolOptions | undefined =
  typeof Worker === "undefined"
    ? undefined
    : {
        workerFactory: () => new HighlightWorker(),
        poolSize: Math.min(4, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2))),
      };

/** Tells the workers the code's themes, which settings may change. */
function PoolThemes({ themes }: { themes: CodeThemes }) {
  const pool = useWorkerPool();
  const { light, dark } = themes;
  useEffect(() => {
    void pool?.setRenderOptions({ theme: { light, dark } });
  }, [pool, light, dark]);
  return null;
}

/** A line's height in pixels, as measured within a `DiffScroll`; 0 until known. */
const LineHeight = createContext(0);

/**
 * Where diffs scroll, one or many: the renderer draws only their lines in view. Diffs within it
 * come with headers of their own. The renderer places lines by their height, which it is told:
 * guessing it, it draws the lines for another place than the one in view, and may keep drawing
 * others while the view stays (with lines of 15px, e.g.). So a line's height is measured, and
 * again when the code's size changes.
 */
export function DiffScroll({
  className,
  themes,
  children,
}: {
  className?: string;
  themes: CodeThemes; // the diffs', for the workers that highlight them
  children: ReactNode;
}) {
  const line = useRef<HTMLDivElement>(null);
  const [lineHeight, setLineHeight] = useState(0);
  useLayoutEffect(() => {
    const element = line.current;
    if (element === null) return;
    setLineHeight(element.getBoundingClientRect().height);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setLineHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scroll = (
    <Virtualizer className={className}>
      <div ref={line} style={{ position: "absolute", height: LINE_HEIGHT }} aria-hidden />
      <LineHeight.Provider value={lineHeight}>
        <Scroller>{children}</Scroller>
      </LineHeight.Provider>
    </Virtualizer>
  );
  if (POOL === undefined) return scroll;
  return (
    <WorkerPoolContextProvider
      poolOptions={POOL}
      highlighterOptions={{ theme: themes, lineDiffType: "word-alt" }}
    >
      <PoolThemes themes={themes} />
      {scroll}
    </WorkerPoolContextProvider>
  );
}

/** Tells what lies within the renderer's element that scrolls (`useDiffScroller`). */
function Scroller({ children }: { children: ReactNode }) {
  const virtualizer = useVirtualizer();
  const root = () => {
    const element = virtualizer?.getRoot();
    return element instanceof HTMLElement ? element : undefined;
  };
  return <DiffScrollerContext value={root}>{children}</DiffScrollerContext>;
}

/** A diff given to the renderer, and what it was made of. */
interface Given extends Versions {
  patch: string;
  known: boolean;
  fileDiff: FileDiffMetadata;
}

/** A patch's diff for the renderer, filled in with both versions where known. */
function diffOf(patch: string, versions: Versions | undefined): FileDiffMetadata {
  const partial = getSingularPatch(patch);
  return bothSides(versions ? withVersions(partial, versions) : partial);
}

const lineKey = (old: number | null, current: number | null) => `${old}:${current}`;

/** A drawn line's numbers in the old and new versions, as the renderer's attributes say. */
function drawnLineKey(element: HTMLElement): string {
  const line = Number(element.dataset.line);
  const other = element.dataset.altLine === undefined ? null : Number(element.dataset.altLine);
  if (element.dataset.lineType === "change-deletion") return lineKey(line, null);
  if (element.dataset.lineType === "change-addition") return lineKey(null, line);
  // Unchanged: its number on its own side, the other's besides; side by side, the left is old.
  return element.closest("[data-deletions]") ? lineKey(line, other) : lineKey(other, line);
}

/**
 * A diff's matches marked on its drawn lines, again whenever the renderer draws, e.g. lines that
 * scroll into view; the current one scrolled to; which are on lines shown, told. Gives the
 * renderer's `onPostRender`, which hands over its diff as drawn.
 */
function useFound(find: DiffFind | undefined) {
  const scroller = useDiffScroller();
  const drawn = useRef<{ node: HTMLElement; diff: VirtualizedFileDiff }>(undefined);
  const latest = useRef(find);
  const unmark = useRef<() => void>(undefined); // the matches marked last
  const told = useRef<{ marks: readonly DiffMark[]; shown: string }>(undefined);
  const lastCurrent = useRef<DiffMark>(undefined); // the current match, as at the last render
  const scrollTo = useRef<DiffMark>(undefined); // the current match, once it can be scrolled to
  const resized = useRef<ResizeObserver>(undefined);

  const markDrawn = (node: HTMLElement, find: DiffFind) => {
    const found: Marked[] = [];
    const byLine = new Map<string, DiffMark[]>();
    for (const mark of find.marks) {
      const key = lineKey(mark.old, mark.new);
      byLine.set(key, [...(byLine.get(key) ?? []), mark]);
    }
    for (const element of node.shadowRoot?.querySelectorAll<HTMLElement>("[data-line]") ?? []) {
      for (const mark of byLine.get(drawnLineKey(element)) ?? []) {
        const range = rangeIn(element, mark.start, mark.end);
        if (range !== undefined) found.push({ range, current: mark === find.current });
      }
    }
    unmark.current?.();
    unmark.current = markMatches(found);
  };
  const tellShown = (diff: VirtualizedFileDiff, find: DiffFind) => {
    const shown = find.marks.flatMap((mark, at) =>
      mark.inPatch || mark.new === null || diff.isLineRenderable(mark.new) ? [at] : [],
    );
    const text = shown.join();
    if (told.current?.marks === find.marks && told.current.shown === text) return;
    told.current = { marks: find.marks, shown: text };
    find.onShown(shown);
  };
  // Brought into view, unless it is well within it already: a third down, below the headers.
  // Whether it is in view: until then, tried again as the diff is drawn or grows, since the
  // renderer gives it its height after drawing it, and may draw it anew, e.g. once its line
  // height is measured, scrolled back to its top meanwhile.
  const show = (mark: DiffMark): boolean => {
    const { node, diff } = drawn.current ?? {};
    const line = mark.new ?? mark.old;
    const root = scroller();
    if (node === undefined || diff === undefined || line === null || root === undefined)
      return true;
    const position = diff.getLinePosition(line, mark.new === null ? "deletions" : "additions");
    if (position === undefined) return true;
    // Where the diff is in what scrolls, by where both are now: the renderer's own offset is off
    // in WebKit once scrolled.
    const offset = node.getBoundingClientRect().top - root.getBoundingClientRect().top;
    const top = root.scrollTop + offset + position.top;
    const height = root.clientHeight;
    if (
      top > root.scrollTop + height * 0.2 &&
      top + position.height < root.scrollTop + height * 0.8
    )
      return true;
    // The element's own: the renderer's clamps by its height as last measured.
    if (top + position.height <= root.scrollHeight) root.scrollTo({ top: top - height / 3 });
    return false;
  };
  const update = () => {
    const find = latest.current;
    if (drawn.current === undefined) return;
    if (find === undefined) {
      unmark.current?.();
      unmark.current = undefined;
      return;
    }
    markDrawn(drawn.current.node, find);
    tellShown(drawn.current.diff, find);
    if (scrollTo.current !== undefined && show(scrollTo.current)) scrollTo.current = undefined;
  };

  // After each render: the matches as now, and another current one to bring into view.
  useEffect(() => {
    latest.current = find;
    if (find?.current !== lastCurrent.current) {
      lastCurrent.current = find?.current;
      scrollTo.current = find?.current;
    }
    update();
  });
  useEffect(
    () => () => {
      unmark.current?.();
      resized.current?.disconnect();
    },
    [],
  );
  return (node: HTMLElement, diff: unknown) => {
    if (!(diff instanceof VirtualizedFileDiff)) return;
    // The renderer gives the diff its height after drawing it, without drawing again: once it
    // grows, the current match may be brought into view.
    if (drawn.current?.node !== node) {
      resized.current?.disconnect();
      resized.current = new ResizeObserver(update);
      resized.current.observe(node);
    }
    drawn.current = { node, diff };
    update();
  };
}

/** A match's line as the renderer selects lines, to mark the current one's: side by side, its
 * row, both sides. */
function currentLine(mark: DiffMark | undefined): SelectedLineRange | null {
  const line = mark?.new ?? mark?.old;
  if (mark === undefined || line === undefined || line === null) return null;
  return { start: line, end: line, side: mark.new === null ? "deletions" : "additions" };
}

/**
 * A file's diff from git's patch, highlighted, with words changed within lines marked; once its
 * versions are known, with where it ends and its collapsed lines to expand. Lines expanded stay so
 * until Whole file is turned on or off: the renderer can't collapse them again, so it starts anew. Matches found in it are marked (`find`). Within a `DiffScroll`.
 */
export default function Diff({ patch, look, themes, versions, find }: Props) {
  const lineHeight = useContext(LineHeight);
  // The diff the renderer was given, kept while its patch and versions' text stay: a new one,
  // even an equal one, has it draw the file anew, e.g. for versions asked for again, unchanged.
  // Held, as React keeps what a render showed, since a memo may be dropped and recomputed.
  const [given, setGiven] = useState<Given>();
  const { old = null, new: current = null } = versions ?? {};
  const known = versions !== undefined;
  const same =
    given?.patch === patch && given.known === known && given.old === old && given.new === current;
  const fileDiff = same ? given.fileDiff : diffOf(patch, known ? { old, new: current } : undefined);
  if (!same) setGiven({ patch, known, old, new: current, fileDiff });
  const onPostRender = useFound(find);
  // The renderer takes its line height once: a new one starts it anew.
  return (
    <FileDiff
      key={`${look.whole ? "whole" : "changes"} ${lineHeight}`}
      fileDiff={fileDiff}
      selectedLines={currentLine(find?.current)}
      metrics={lineHeight > 0 ? { ...DEFAULT_VIRTUAL_FILE_METRICS, lineHeight } : undefined}
      options={{
        theme: themes,
        themeType: "system", // as the page: the system's
        diffStyle: look.split ? "split" : "unified",
        overflow: look.wrap ? "wrap" : "scroll",
        expandUnchanged: look.whole,
        lineDiffType: "word-alt",
        diffIndicators: "bars",
        disableFileHeader: true,
        unsafeCSS: PAGE_LOOK,
        onPostRender,
      }}
    />
  );
}

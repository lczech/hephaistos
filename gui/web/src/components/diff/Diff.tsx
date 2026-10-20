// The one module that knows the diff renderer, @pierre/diffs: the rest of the GUI gives it
// git's patch and options in its own terms, so that another renderer could take its place.
// Large, with its highlighter: loaded only once a diff shows (`LazyDiff`).

import { DEFAULT_VIRTUAL_FILE_METRICS, getSingularPatch, hydratePartialDiff } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import { FileDiff, Virtualizer } from "@pierre/diffs/react";
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

interface Props {
  patch: string; // git's, for one file
  look: DiffLook;
  themes: CodeThemes;
  versions: Versions | undefined; // once known: to show where the file ends, and more of it
}

// A line of code's height: the renderer's, and ours to hold diffs' places (`height.ts`).
const LINE_HEIGHT = "calc(var(--code-size) * 1.5)";

// The page's background under the code, whatever the theme's: the renderer mixes the colours
// of lines added and removed from it; and the code's font and size. The lines left out between
// changes as gaps between two lines, rather than bars: quieter than the files' headers. The renderer's
// own variables and attributes, so check them on upgrades.
const PAGE_LOOK = `:host {
  --diffs-light-bg: var(--background);
  --diffs-dark-bg: var(--background);
  --diffs-bg-separator: var(--background);
  --diffs-font-family: var(--font-mono);
  --diffs-font-size: var(--code-size);
  --diffs-line-height: ${LINE_HEIGHT};
}
[data-separator=line-info] {
  box-shadow: inset 0 1px var(--line), inset 0 -1px var(--line);
}
[data-separator=line-info] [data-separator-wrapper],
[data-separator=line-info] [data-separator-content],
[data-separator=line-info] [data-expand-button] {
  background: none;
}`;

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

/** A line's height in pixels, as measured within a `DiffScroll`; 0 until known. */
const LineHeight = createContext(0);

/**
 * Where diffs scroll, one or many: the renderer draws only their lines in view. Diffs within it
 * come with headers of their own. The renderer places lines by their height, which it is told:
 * guessing it, it draws the lines for another place than the one in view, and may keep drawing
 * others while the view stays (with lines of 15px, e.g.). So a line's height is measured, and
 * again when the code's size changes.
 */
export function DiffScroll({ className, children }: { className?: string; children: ReactNode }) {
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
  return (
    <Virtualizer className={className}>
      <div ref={line} style={{ position: "absolute", height: LINE_HEIGHT }} aria-hidden />
      <LineHeight.Provider value={lineHeight}>{children}</LineHeight.Provider>
    </Virtualizer>
  );
}

/**
 * A file's diff from git's patch, highlighted, with words changed within lines marked; once its
 * versions are known, with where it ends and all of it to show. Lines shown on asking stay so
 * until the whole file is shown or no longer is: the renderer can't fold them again, so it
 * starts anew. Within a `DiffScroll`.
 */
export default function Diff({ patch, look, themes, versions }: Props) {
  const lineHeight = useContext(LineHeight);
  const partial = useMemo(() => getSingularPatch(patch), [patch]);
  // By their text: versions asked for again, unchanged, leave the diff as it is.
  const known = versions !== undefined;
  const { old: oldText = null, new: newText = null } = versions ?? {};
  const fileDiff = useMemo(
    () => bothSides(known ? withVersions(partial, { old: oldText, new: newText }) : partial),
    [partial, known, oldText, newText],
  );
  // The renderer takes its line height once: a new one starts it anew.
  return (
    <FileDiff
      key={`${look.whole ? "whole" : "changes"} ${lineHeight}`}
      fileDiff={fileDiff}
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
      }}
    />
  );
}

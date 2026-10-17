// The one module that knows the diff renderer, @pierre/diffs: the rest of the GUI gives it
// git's patch and options in its own terms, so that another renderer could take its place.
// Large, with its highlighter: loaded only once a diff shows (`LazyDiff`).

import { getSingularPatch, hydratePartialDiff } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import { FileDiff } from "@pierre/diffs/react";
import { type ReactNode, useMemo } from "react";
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
  header: ReactNode; // above it, staying in view while it scrolls
  look: DiffLook;
  themes: CodeThemes;
  versions: Versions | undefined; // once known: to show where the file ends, and more of it
}

// The page's background under the code, whatever the theme's: the renderer mixes the colours
// of lines added and removed from it; and the code's font and size. The renderer's own
// variables, so check them on upgrades.
const PAGE_LOOK = `:host {
  --diffs-light-bg: var(--background);
  --diffs-dark-bg: var(--background);
  --diffs-font-family: var(--font-mono);
  --diffs-font-size: var(--code-size);
  --diffs-line-height: calc(var(--code-size) * 1.5);
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
 * A file's diff from git's patch, highlighted, with words changed within lines marked; once its
 * versions are known, with where it ends and all of it to show. Lines shown on asking stay so
 * until the whole file is shown or no longer is: the renderer can't fold them again, so it
 * starts anew.
 */
export default function Diff({ patch, header, look, themes, versions }: Props) {
  const partial = useMemo(() => getSingularPatch(patch), [patch]);
  const fileDiff = useMemo(
    () => (versions ? withVersions(partial, versions) : partial),
    [partial, versions],
  );
  return (
    <FileDiff
      key={look.whole ? "whole" : "changes"}
      fileDiff={fileDiff}
      renderCustomHeader={() => header}
      options={{
        theme: themes,
        themeType: "system", // as the page: the system's
        diffStyle: look.split ? "split" : "unified",
        overflow: look.wrap ? "wrap" : "scroll",
        expandUnchanged: look.whole,
        lineDiffType: "word-alt",
        diffIndicators: "bars",
        stickyHeader: true,
        unsafeCSS: PAGE_LOOK,
      }}
    />
  );
}

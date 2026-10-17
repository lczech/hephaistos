// The one module that knows the diff renderer, @pierre/diffs: the rest of the GUI gives it
// git's patch and options in its own terms, so that another renderer could take its place.
// Large, with its highlighter: loaded only once a diff shows (`LazyDiff`).

import type { FileDiffLoadedFiles, FileDiffMetadata } from "@pierre/diffs/react";
import { PatchDiff } from "@pierre/diffs/react";
import { type ReactNode, useCallback } from "react";
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
  versions: () => Promise<Versions>; // asked for only to show more than the patch has
}

// The page's background under the code, whatever the theme's: the renderer mixes the colours
// of lines added and removed from it. The renderer's own variables, so check them on upgrades.
const PAGE_BACKGROUND = `:host {
  --diffs-light-bg: var(--background);
  --diffs-dark-bg: var(--background);
}`;

/**
 * A file's diff from git's patch, highlighted, with words changed within lines marked. Lines
 * shown on asking stay so until the whole file is shown or no longer is: the renderer can't fold
 * them again, so it starts anew.
 */
export default function Diff({ patch, header, look, themes, versions }: Props) {
  const load = useCallback(
    async (diff: FileDiffMetadata): Promise<FileDiffLoadedFiles> => {
      const found = await versions();
      const newFile = { name: diff.name, contents: found.new ?? "" };
      if (found.old === null) return { oldFile: null, newFile };
      return { oldFile: { name: diff.prevName ?? diff.name, contents: found.old }, newFile };
    },
    [versions],
  );
  return (
    <PatchDiff
      key={look.whole ? "whole" : "changes"}
      patch={patch}
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
        loadDiffFiles: load,
        unsafeCSS: PAGE_BACKGROUND,
      }}
    />
  );
}

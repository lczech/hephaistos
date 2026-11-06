// Icons drawn here, on Lucide's 24px grid and in its style, where Lucide has none: Lucide's own
// function makes them, so they take its size, colour and stroke like the others.

import { createLucideIcon } from "lucide-react";

/** Several files' diffs: Lucide's `file-diff`, smaller, with a page behind it. */
export const FileDiffs = createLucideIcon({
  name: "file-diffs",
  node: [
    [
      "path",
      {
        d: "M10 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h6a2.4 2.4 0 0 1 1.704.706l2.588 2.588A2.4 2.4 0 0 1 21 7v9a2 2 0 0 1-2 2z",
        key: "page",
      },
    ],
    ["path", { d: "M5 6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 1.732-1", key: "behind" }],
    ["path", { d: "M12 8.5h5", key: "plus" }],
    ["path", { d: "M14.5 6v5", key: "plus-stem" }],
    ["path", { d: "M12 14h5", key: "minus" }],
  ],
});

/** Commits following each other, as History lists them: Lucide's `git-commit-vertical` with two
 * commits of its size on its line, the line through the whole height. */
export const GitCommits = createLucideIcon({
  name: "git-commits",
  node: [
    ["path", { d: "M12 2v2", key: "above" }],
    ["circle", { cx: "12", cy: "7", r: "3", key: "newer" }],
    ["path", { d: "M12 10v4", key: "between" }],
    ["circle", { cx: "12", cy: "17", r: "3", key: "older" }],
    ["path", { d: "M12 20v2", key: "below" }],
  ],
});

/** A list with each row in two lines: Lucide's `table` with two rows, a long and a short line
 * in each, beside `table` for columns. */
export const TableLines = createLucideIcon({
  name: "table-lines",
  node: [
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "frame" }],
    ["path", { d: "M3 12h18", key: "between" }],
    ["path", { d: "M7 6.5h10", key: "first" }],
    ["path", { d: "M7 9.5h5", key: "first-second" }],
    ["path", { d: "M7 15.5h10", key: "second" }],
    ["path", { d: "M7 18.5h5", key: "second-second" }],
  ],
});

// Lucide's `file-diff` pages, as `FileDiffs` has them, for the chevrons of the stack's files.
const FRONT_PAGE =
  "M10 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h6a2.4 2.4 0 0 1 1.704.706l2.588 2.588A2.4 2.4 0 0 1 21 7v9a2 2 0 0 1-2 2z";
const PAGE_BEHIND = "M5 6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 1.732-1";

/** All files of a stack unfolded: `FileDiffs`' pages with the chevron down, as an unfolded
 * file's header shows it. */
export const FilesUnfolded = createLucideIcon({
  name: "files-unfolded",
  node: [
    ["path", { d: FRONT_PAGE, key: "page" }],
    ["path", { d: PAGE_BEHIND, key: "behind" }],
    ["path", { d: "m11.5 8.5 3 3 3-3", key: "chevron" }],
  ],
});

/** All files of a stack folded: the pages with the chevron right, as a folded file's header. */
export const FilesFolded = createLucideIcon({
  name: "files-folded",
  node: [
    ["path", { d: FRONT_PAGE, key: "page" }],
    ["path", { d: PAGE_BEHIND, key: "behind" }],
    ["path", { d: "m13 7 3 3-3 3", key: "chevron" }],
  ],
});

// Lucide's `folder-tree` folders: the top one, and the bottom one.
const TOP_FOLDER =
  "M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z";
const BOTTOM_FOLDER =
  "M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z";

/** Directories as a flat list: Lucide's `folder-tree` with a straight line before each folder
 * in place of the tree, as far from it as the tree's. */
export const FolderList = createLucideIcon({
  name: "folder-list",
  node: [
    ["path", { d: "M3 7h5", key: "top-line" }],
    ["path", { d: TOP_FOLDER, key: "top" }],
    ["path", { d: "M3 18h5", key: "bottom-line" }],
    ["path", { d: BOTTOM_FOLDER, key: "bottom" }],
  ],
});

/** A folder branching off another, as a Worktree off its Clone: `folder-tree`'s top folder moved
 * to the left, a line down from it and right to the bottom one. */
export const FolderBranch = createLucideIcon({
  name: "folder-branch",
  node: [
    [
      "path",
      {
        d: "M11 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 6 3H4a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z",
        key: "main",
      },
    ],
    ["path", { d: "M7 10v5.5a2 2 0 0 0 2 2h1", key: "branch" }],
    ["path", { d: BOTTOM_FOLDER, key: "off" }],
  ],
});

/** All folders folded: Lucide's `folders` with the chevron right in the front one, as a folded
 * folder's row shows it, beside `FilesFolded` of the Diff. */
export const FoldersFolded = createLucideIcon({
  name: "folders-folded",
  node: [
    [
      "path",
      {
        d: "M20 5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2.5a1.5 1.5 0 0 1 1.2.6l.6.8a1.5 1.5 0 0 0 1.2.6z",
        key: "front",
      },
    ],
    [
      "path",
      { d: "M3 8.268a2 2 0 0 0-1 1.738V19a2 2 0 0 0 2 2h11a2 2 0 0 0 1.732-1", key: "behind" },
    ],
    ["path", { d: "m13 7.5 3 3-3 3", key: "chevron" }],
  ],
});

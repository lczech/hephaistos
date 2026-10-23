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

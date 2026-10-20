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

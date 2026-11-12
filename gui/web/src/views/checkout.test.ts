import { describe, expect, it } from "vitest";
import { clone, repository, worktree } from "../test/server";
import { checkoutName } from "./checkout";

describe("checkoutName", () => {
  const repositories = [
    repository("proj", [
      clone("proj", {
        worktrees: [
          worktree("proj", "feature"),
          // as Orca makes them: git's name an ID, the folder named by the user
          worktree("proj", "2837265-1d6db581", {
            path: "/home/me/workspaces/proj/git-graph",
          }),
        ],
      }),
    ]),
  ];

  it("names a Clone and a Worktree by their folders", () => {
    expect(checkoutName(repositories, { clone: "clone-proj" })).toBe("proj");
    expect(checkoutName(repositories, { worktree: "wt-proj-feature" })).toBe("feature");
  });

  it("names a Worktree by its folder, not by git's name for it", () => {
    expect(checkoutName(repositories, { worktree: "wt-proj-2837265-1d6db581" })).toBe("git-graph");
  });

  it("knows no name while the Repositories are not known, or for a Checkout gone", () => {
    expect(checkoutName(undefined, { clone: "clone-proj" })).toBeUndefined();
    expect(checkoutName(repositories, { worktree: "wt-gone" })).toBeUndefined();
  });
});

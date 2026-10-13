import { Dot, GitBranchPlus, GitCommitHorizontal } from "lucide-react";
import { describe, expect, it } from "vitest";
import { actionIcon, actionOf, entityIcon } from "./icons";

describe("actions", () => {
  it("are what follows the kind's dot, in words", () => {
    expect(actionOf("clone.committed")).toBe("committed");
    expect(actionOf("worktree.branch_switched")).toBe("branch switched");
    expect(actionOf("odd")).toBe("odd");
  });

  it("have icons, shared by kinds, and a dot for new ones", () => {
    expect(actionIcon(actionOf("clone.committed"))).toBe(GitCommitHorizontal);
    expect(actionIcon(actionOf("worktree.committed"))).toBe(GitCommitHorizontal);
    expect(actionIcon("branch created")).toBe(GitBranchPlus);
    expect(actionIcon("teleported")).toBe(Dot);
    expect(entityIcon("terminal")).toBe(Dot);
  });
});

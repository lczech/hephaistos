import {
  BookPlus,
  Box,
  Computer,
  DiamondPlus,
  Dot,
  GitBranchPlus,
  GitCommitVertical,
  SquarePlus,
} from "lucide-react";
import { describe, expect, it } from "vitest";
import { actionOf, entityIcon, kindIcon } from "./icons";

describe("actions", () => {
  it("are what follows the kind's dot, in words", () => {
    expect(actionOf("clone.committed")).toBe("committed");
    expect(actionOf("worktree.branch_switched")).toBe("branch switched");
    expect(actionOf("odd")).toBe("odd");
  });

  it("have icons, shared by kinds, and a dot for new ones", () => {
    expect(kindIcon("clone.committed")).toBe(GitCommitVertical);
    expect(kindIcon("worktree.committed")).toBe(GitCommitVertical);
    expect(kindIcon("clone.branch_created")).toBe(GitBranchPlus);
    expect(kindIcon("clone.teleported")).toBe(Dot);
    expect(entityIcon("terminal")).toBe(Dot);
  });

  it("show the Registry's by the entity's icon, else a square; git's by a diamond", () => {
    expect(kindIcon("repository.registered")).toBe(BookPlus);
    expect(kindIcon("mount.registered")).toBe(SquarePlus);
    expect(kindIcon("worktree.added")).toBe(DiamondPlus);
  });

  it("show a Machine by its chassis, a computer if unknown", () => {
    expect(entityIcon("machine", "vm")).toBe(Box);
    expect(entityIcon("machine", null)).toBe(Computer);
    expect(entityIcon("machine", "spaceship")).toBe(Computer);
  });
});

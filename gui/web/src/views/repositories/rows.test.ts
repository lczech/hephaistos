import { describe, expect, it } from "vitest";
import { clone, repository, worktree } from "../../test/server";
import {
  branchTitle,
  entries,
  nameText,
  nameTitle,
  sorting,
  sortParams,
  statusText,
  statusTitle,
  tone,
  worktreePath,
} from "./rows";

describe("a Checkout's status", () => {
  it("reads as the CLI's lists show it, and spelled out", () => {
    const dirty = clone("proj", { staged: 2, changed: 3, untracked: 1, ahead: 1, behind: 2 });
    expect(statusText(dirty)).toBe("+2 ~3 ?1 ↑1 ↓2");
    expect(statusTitle(dirty)).toBe(
      "2 staged, 3 changed, 1 untracked; 1 ahead of and 2 behind origin/main",
    );
    expect(statusText(clone("proj"))).toBe("clean");
    expect(statusTitle(clone("proj"))).toBe("no changes; up to date with origin/main");
    const alone = clone("proj", { upstream: null, ahead: null, behind: null, changed: 1 });
    expect(statusTitle(alone)).toBe("1 changed; no upstream");
  });

  it("says when it is missing, failed or bare instead", () => {
    expect(statusText(clone("proj", { present: false }))).toBe("missing");
    expect(statusText(clone("proj", { error: "git timed out" }))).toBe("failed");
    expect(statusTitle(clone("proj", { error: "git timed out" }))).toBe("failed: git timed out");
    expect(statusText(clone("proj", { staged: null }))).toBe("bare");
  });

  it("names its branch with what it tracks, or the commit a detached HEAD is at", () => {
    expect(branchTitle(clone("proj"))).toBe("main, tracking origin/main");
    expect(branchTitle(clone("proj", { upstream: null }))).toBe("main, no upstream");
    const detached = clone("proj", { branch: null, head: "3f2a1c9d0e" });
    expect(branchTitle(detached)).toBe("detached at 3f2a1c9");
    expect(branchTitle(clone("proj", { branch: null, head: null }))).toBe("detached");
  });
});

describe("the rows", () => {
  const feature = worktree("proj", "feature");
  const [proj] = entries([repository("proj", [clone("proj", { worktrees: [feature] })])]);

  it("hold Clones within Repositories, Worktrees within Clones, named by their paths", () => {
    const [inClone] = proj?.subRows ?? [];
    const [inWorktree] = inClone?.subRows ?? [];
    const names = [proj, inClone, inWorktree].map((entry) => entry && nameText(entry, "/home/me"));
    expect(names).toEqual(["proj", "~/proj", ".worktrees/feature"]);
    const titles = [proj, inClone, inWorktree].map((entry) => entry && nameTitle(entry));
    expect(titles).toEqual([undefined, "/home/me/proj", "/home/me/proj/.worktrees/feature"]);
    const [linked] = entries([
      repository("proj", [clone("proj", { resolved_path: "/data/proj" })]),
    ]);
    const linkedClone = linked?.subRows[0];
    expect(linkedClone && nameTitle(linkedClone)).toBe("/home/me/proj\nresolves to /data/proj");
    const elsewhere = worktree("proj", "x", { path: "/tmp/x" });
    expect(worktreePath(elsewhere, clone("proj"), "/home/me")).toBe("/tmp/x");
  });

  it("are toned by their Checkouts' State only", () => {
    const toned = (fields: Parameters<typeof clone>[1]) => {
      const [entry] = entries([repository("proj", [clone("proj", fields)])]);
      return [entry && tone(entry), entry?.subRows[0] && tone(entry.subRows[0])];
    };
    expect(toned({ conflicted: 1 })).toEqual([undefined, "danger"]);
    expect(toned({ present: false })).toEqual([undefined, "warning"]);
    expect(toned({ staged: null })).toEqual([undefined, "muted"]);
    expect(toned({})).toEqual([undefined, undefined]);
  });
});

describe("the order", () => {
  it("is the most recently active first, unless the parameters say otherwise", () => {
    expect(sorting({})).toEqual([{ id: "active", desc: true }]);
    expect(sorting({ sort: "name" })).toEqual([{ id: "name", desc: false }]);
    expect(sorting({ sort: "-name" })).toEqual([{ id: "name", desc: true }]);
    expect(sorting({ sort: "size" })).toEqual([{ id: "active", desc: true }]);
    expect(sortParams({ x: "1" }, [{ id: "name", desc: false }])).toEqual({ x: "1", sort: "name" });
    expect(sortParams({ sort: "name" }, [{ id: "active", desc: true }])).toEqual({});
  });
});

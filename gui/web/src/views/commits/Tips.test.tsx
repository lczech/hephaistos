import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type Commit, entries, graphOf, type Ref } from "./rows";
import { tipsBand } from "./Tips";

const person = { name: "L", email: "l@example.org", at: "2026-01-01T00:00:00Z" };
const ref = (name: string, kind: Ref["kind"]): Ref => ({ name, full: name, kind, commit: "" });
const commit = (hash: string, parents: string[], refs: Ref[] = []): Commit => ({
  hash,
  parents,
  subject: hash,
  body: "",
  author: person,
  committer: person,
  refs,
  renamed_from: null,
});

describe("the band of a graph", () => {
  // Three lines from b: a branch, a tag alone, and a Worktree detached without refs.
  const listed = entries([
    commit("f".repeat(40), ["b"], [ref("v2", "tag"), ref("feature", "branch")]),
    commit("t".repeat(40), ["b"], [ref("v1", "tag")]),
    commit("d".repeat(40), ["b"]),
    commit("b", []),
  ]);
  const checkedOut = [
    { name: "loose", path: "/p/loose", worktree: true, branch: null, commit: "d".repeat(40) },
  ];
  const drawn = graphOf(listed, undefined, {
    heads: new Set(["f".repeat(40), "d".repeat(40)]),
    checkedOut,
  });

  it("names each tip by its branch, else its first ref, else the Checkout detached there", async () => {
    const onTip = vi.fn();
    render(tipsBand(drawn, undefined, onTip)(2).subject);
    const titles = screen.getAllByRole("button").map((button) => button.title);
    expect(titles.sort()).toEqual(["Go to feature", "Go to loose", "Go to v1"]);
    await userEvent.click(screen.getByTitle("Go to v1"));
    expect(onTip).toHaveBeenCalledWith("t".repeat(40));
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FindBar } from "./FindBar";

const query = { text: "a", matchCase: false, wholeWord: false, regex: false };

function bar(busy: boolean) {
  return (
    <FindBar
      label="Find"
      query={query}
      onChange={() => {}}
      onTypingEnd={() => {}}
      finding={{ matches: [{ line: 0, start: 0, end: 1 }], more: false, busy: false }}
      count={1}
      current={0}
      onStep={() => {}}
      onClose={() => {}}
      busy={busy}
      note={{ text: "stopped after 10 s", title: "why" }}
    />
  );
}

describe("the find row", () => {
  it("turns its search icon while busy, and says why there may be more", () => {
    const { container, rerender } = render(bar(false));
    const search = container.querySelector("search") as HTMLElement; // jsdom knows no role for it
    expect(search.querySelector(".lucide-loader-circle")).toBeNull();
    expect(screen.getByText("1 of 1; stopped after 10 s")).toHaveAttribute("title", "why");
    rerender(bar(true));
    expect(search).toHaveAttribute("data-busy");
    expect(search.querySelector(".lucide-loader-circle")).not.toBeNull();
  });
});

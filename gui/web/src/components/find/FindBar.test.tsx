import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FindBar, TYPING_PAUSE } from "./FindBar";
import type { FindQuery } from "./pattern";

const query = { text: "a", matchCase: false, wholeWord: false, regex: false };

function bar(busy: boolean) {
  return (
    <FindBar
      label="Find"
      query={query}
      onChange={() => {}}
      onTypingEnd={() => {}}
      finding={{ matches: [{ line: 0, start: 0, end: 1 }], more: false, busy: false, in: ["a"] }}
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

/** The row as a View holds it: its query changed only as the row passes it on. */
function Held({
  query,
  onChange,
  onStep,
}: {
  query: FindQuery;
  onChange: (query: FindQuery) => void;
  onStep: () => void;
}) {
  return (
    <FindBar
      label="Find"
      query={query}
      onChange={onChange}
      onTypingEnd={() => {}}
      finding={undefined}
      count={0}
      current={0}
      onStep={onStep}
      onClose={() => {}}
    />
  );
}

describe("what is typed in the find row", () => {
  const empty = { ...query, text: "" };

  it("goes to the View once typing pauses, all of it at once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const onChange = vi.fn();
      render(<Held query={empty} onChange={onChange} onStep={() => {}} />);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.type(screen.getByRole("textbox", { name: "Find" }), "abc");
      expect(screen.getByRole("textbox", { name: "Find" })).toHaveValue("abc"); // at once
      expect(onChange).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(TYPING_PAUSE));
      expect(onChange.mock.calls).toEqual([[{ ...empty, text: "abc" }, true]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes at once on Enter, which then looks for it rather than stepping", async () => {
    const [onChange, onStep] = [vi.fn(), vi.fn()];
    render(<Held query={empty} onChange={onChange} onStep={onStep} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Find" }), "ab{Enter}");
    expect(onChange).toHaveBeenCalledWith({ ...empty, text: "ab" }, true);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("gives way to a text the View has otherwise, e.g. going back", async () => {
    const { rerender } = render(<Held query={empty} onChange={() => {}} onStep={() => {}} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Find" }), "ab");
    rerender(<Held query={{ ...empty, text: "x" }} onChange={() => {}} onStep={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Find" })).toHaveValue("x");
  });
});

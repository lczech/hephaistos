import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FindQuery } from "./pattern";
import { useCurrentMatch, useFind } from "./useFind";

const QUERY: FindQuery = { text: "b", matchCase: false, wholeWord: false, regex: false };

describe("a find", () => {
  it("keeps what it found while it finds again, in the lines it found it in", async () => {
    const before = ["a", "b"];
    const after = ["b", "a", "b"];
    const { result, rerender } = renderHook(({ lines }) => useFind(lines, QUERY), {
      initialProps: { lines: before },
    });
    expect(result.current).toEqual({ busy: true }); // nothing found yet
    await waitFor(() => expect(result.current).toMatchObject({ busy: false, in: before }));
    const found = result.current && "matches" in result.current ? result.current.matches : [];
    expect(found.map((match) => match.line)).toEqual([1]);
    rerender({ lines: after });
    expect(result.current).toMatchObject({ busy: true, in: before, matches: found });
    await waitFor(() => expect(result.current).toMatchObject({ busy: false, in: after }));
    const again = result.current && "matches" in result.current ? result.current.matches : [];
    expect(again.map((match) => match.line)).toEqual([0, 2]);
  });
});

describe("the current match", () => {
  it("steps round, and is the first again once the matches are others", () => {
    const { result, rerender } = renderHook(({ of }) => useCurrentMatch(of, 3), {
      initialProps: { of: "a" },
    });
    act(() => result.current[1](-1));
    expect(result.current[0]).toBe(2);
    rerender({ of: "b" });
    expect(result.current[0]).toBe(0);
  });

  it("stays the one stepped to where the order moves it, by its key", () => {
    const { result, rerender } = renderHook(({ keys }) => useCurrentMatch("a", 3, keys), {
      initialProps: { keys: ["x", "y", "z"] },
    });
    act(() => result.current[1](1));
    expect(result.current[0]).toBe(1); // y
    rerender({ keys: ["y", "z", "x"] }); // sorted anew
    expect(result.current[0]).toBe(0);
    rerender({ keys: ["z", "x"] }); // gone: where it was
    expect(result.current[0]).toBe(1);
  });
});

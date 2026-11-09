import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCurrentMatch } from "./useFind";

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

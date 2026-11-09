import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BarEnd, BarGroup } from "./ViewBar";

/** A button that draws nothing, as one shown only sometimes may. */
function Nothing() {
  return null;
}

describe("the end of a bar, as drawn", () => {
  it("draws a line between groups only where buttons are drawn on both sides", () => {
    const { container } = render(
      <BarEnd>
        <BarGroup>
          <Nothing />
        </BarGroup>
        <BarGroup>
          <button type="button">a</button>
        </BarGroup>
        <BarGroup>
          <Nothing />
        </BarGroup>
        <BarGroup>
          <button type="button">b</button>
        </BarGroup>
      </BarEnd>,
    );
    const groups = [...(container.firstElementChild?.children ?? [])] as HTMLElement[];
    const shown = groups.filter((group) => getComputedStyle(group).display !== "none");
    expect(shown.map((group) => group.textContent)).toEqual(["a", "b"]);
    const lines = shown.map((group) => getComputedStyle(group, "::before").content);
    expect(lines).toEqual(["none", '""']); // one line, between a and b
  });
});

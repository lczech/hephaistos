import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BarEnd, BarGroup } from "./ViewBar";

describe("the end of a bar", () => {
  it("shows its groups of buttons, leaving out those without any, so that no line stands alone", () => {
    const show = false;
    const { container } = render(
      <BarEnd>
        <BarGroup>
          <button type="button">a</button>
        </BarGroup>
        <BarGroup>{show && <button type="button">b</button>}</BarGroup>
        <BarGroup>
          <button type="button">c</button>
        </BarGroup>
      </BarEnd>,
    );
    const groups = [...(container.firstElementChild?.children ?? [])];
    expect(groups.map((group) => group.textContent)).toEqual(["a", "c"]);
  });
});

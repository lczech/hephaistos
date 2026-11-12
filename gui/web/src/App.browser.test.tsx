import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import styles from "./App.module.css";

// The box of the Groups, as browsers lay it out: with what dockview places past the window below
// its Views, it must not scroll, whatever a View brings into view.

const ROWS = Array.from({ length: 40 }, (_, at) => `row ${at + 1}`);

/** A View as high as the box, whose rows scroll, and something past the window below it. */
function Shell() {
  return (
    <div className={styles.app} style={{ height: 200 }}>
      <main className={styles.main} data-testid="main">
        <div data-testid="view" style={{ height: 200, overflow: "auto" }}>
          {ROWS.map((row) => (
            <p key={row} style={{ height: 30, margin: 0 }}>
              {row}
            </p>
          ))}
        </div>
        <div style={{ height: 120 }}>a View not placed yet</div>
      </main>
    </div>
  );
}

describe("the box of the Groups", () => {
  it("never scrolls, where a View's row it brings to the top is near its end", () => {
    render(<Shell />);
    screen.getByText("row 40").scrollIntoView({ block: "start" });
    expect(screen.getByTestId("view").scrollTop).toBeGreaterThan(0);
    expect(screen.getByTestId("main").scrollTop).toBe(0);
  });

  it("never scrolls to what it cuts off", () => {
    render(<Shell />);
    screen.getByText("a View not placed yet").scrollIntoView();
    expect(screen.getByTestId("main").scrollTop).toBe(0);
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NOW, secondsAgo } from "../test/server";
import { fullTime } from "../time";
import { Ago, TimeFormatContext, timeFormatOf } from "./Ago";

describe("a time in a list", () => {
  const old = secondsAgo(400 * 86400);

  it("is relative for a month, then the day, unless the setting says otherwise", () => {
    const { rerender } = render(<Ago at={secondsAgo(5 * 86400)} now={NOW} />);
    expect(screen.getByText("5d ago")).toBeInTheDocument();
    rerender(<Ago at={old} now={NOW} />);
    expect(screen.getByText(fullTime(old).slice(0, 10))).toBeInTheDocument(); // the day
    rerender(
      <TimeFormatContext value="relative">
        <Ago at={old} now={NOW} />
      </TimeFormatContext>,
    );
    expect(screen.getByText("1y ago")).toHaveAttribute("title", expect.stringMatching(/^\d{4}-/));
    rerender(<Ago at={null} now={NOW} />);
    expect(document.body.textContent).toBe("");
  });

  it("takes only the formats the setting knows, else auto", () => {
    expect(timeFormatOf("short")).toBe("short");
    expect(timeFormatOf("long")).toBe("auto");
    expect(timeFormatOf(undefined)).toBe("auto");
  });
});

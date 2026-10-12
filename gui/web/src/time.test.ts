import { describe, expect, it } from "vitest";
import { NOW, secondsAgo } from "./test/server";
import { ago, seconds, secondsUntil } from "./time";

describe("times", () => {
  it("are ages as the CLI shows them", () => {
    expect(ago(secondsAgo(59), NOW)).toBe("now");
    expect(ago(secondsAgo(-30), NOW)).toBe("now"); // clock skew
    expect(ago(secondsAgo(180), NOW)).toBe("3m ago");
    expect(ago(secondsAgo(2 * 3600 + 59), NOW)).toBe("2h ago");
    expect(ago(secondsAgo(5 * 86400), NOW)).toBe("5d ago");
  });

  it("count down to a time, and print seconds", () => {
    expect(secondsUntil(secondsAgo(-40), NOW)).toBe(40);
    expect(secondsUntil(secondsAgo(3), NOW)).toBe(0);
    expect(seconds(0.8)).toBe("0.8 s");
    expect(seconds(60)).toBe("60 s");
    expect(seconds(1 / 3)).toBe("0.333333 s");
  });
});

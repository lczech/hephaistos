import { describe, expect, it } from "vitest";
import { NOW, secondsAgo } from "./test/server";
import {
  ago,
  daysText,
  fullTime,
  preciseTime,
  seconds,
  secondsUntil,
  shortTime,
  timeAndAgo,
  timeText,
} from "./time";

describe("times", () => {
  it("are ages as the CLI shows them", () => {
    expect(ago(secondsAgo(59), NOW)).toBe("now");
    expect(ago(secondsAgo(-30), NOW)).toBe("now"); // clock skew
    expect(ago(secondsAgo(180), NOW)).toBe("3m ago");
    expect(ago(secondsAgo(2 * 3600 + 59), NOW)).toBe("2h ago");
    expect(ago(secondsAgo(5 * 86400), NOW)).toBe("5d ago");
    expect(ago(secondsAgo(29 * 86400 + 82800), NOW)).toBe("29d ago");
    expect(ago(secondsAgo(30 * 86400), NOW)).toBe("1mo ago");
    expect(ago(secondsAgo(359 * 86400), NOW)).toBe("11mo ago");
    expect(ago(secondsAgo(364 * 86400), NOW)).toBe("1y ago");
    expect(ago(secondsAgo(2345 * 86400), NOW)).toBe("6y ago");
  });

  it("are short as `ls` shows them, and as the setting says, relative for a month", () => {
    const now = new Date(2026, 9, 5, 14, 3).getTime();
    const at = (...parts: [number, number, number, number, number]) => new Date(...parts).getTime();
    expect(shortTime(at(2026, 9, 5, 9, 15), now)).toBe("09:15");
    expect(shortTime(at(2026, 2, 2, 8, 0), now)).toBe("03-02 08:00");
    expect(shortTime(at(2025, 11, 31, 23, 0), now)).toBe("2025-12-31");
    const old = at(2019, 2, 3, 9, 0);
    expect(timeText(old, now, "auto")).toBe("2019-03-03");
    expect(timeText(old, now, "recent")).toBe("2019-03-03");
    expect(timeText(at(2026, 9, 1, 9, 0), now, "auto")).toBe("4d ago");
    expect(timeText(at(2026, 2, 2, 8, 0), now, "auto")).toBe("2026-03-02"); // the day, this year too
    expect(timeText(old, now, "relative")).toBe("7y ago");
    expect(timeText(old, now, "full")).toBe("2019-03-03 09:00:00");
  });

  it("count down to a time, and print seconds", () => {
    expect(secondsUntil(secondsAgo(-40), NOW)).toBe(40);
    expect(secondsUntil(secondsAgo(3), NOW)).toBe(0);
    expect(secondsUntil(NOW + 7200, NOW)).toBe(8); // milliseconds, rounded up
    expect(seconds(0.8)).toBe("0.8 s");
    expect(seconds(60)).toBe("60 s");
    expect(seconds(1 / 3)).toBe("0.333333 s");
  });
});

describe("fullTime", () => {
  it("is the local time, to the second", () => {
    const at = new Date(2026, 9, 5, 14, 3, 21);
    expect(fullTime(at.toISOString())).toBe("2026-10-05 14:03:21");
    expect(fullTime(at.getTime())).toBe("2026-10-05 14:03:21"); // milliseconds alike
  });

  it("goes with how long ago, in details", () => {
    const at = new Date(2026, 9, 5, 14, 3, 21, 7).getTime();
    expect(timeAndAgo(at, at + 180_000)).toBe("2026-10-05 14:03:21 (3m ago)");
    expect(timeAndAgo(at, at + 180_000, true)).toBe("2026-10-05 14:03:21.007 (3m ago)");
  });
});

describe("preciseTime", () => {
  it("is the local time to the millisecond, as `log show` prints it", () => {
    expect(preciseTime(new Date(2026, 9, 5, 14, 3, 21, 7).toISOString())).toBe(
      "2026-10-05 14:03:21.007",
    );
  });
});

describe("daysText", () => {
  const now = new Date(2026, 10, 13, 12).getTime();
  it("says the days from one time to another, in local time, the year where not this one", () => {
    const at = (month: number, day: number, year = 2026) => new Date(year, month, day, 9).getTime();
    expect(daysText(at(9, 3), at(10, 10), now)).toBe("Oct 3 – Nov 10");
    expect(daysText(at(9, 3), at(9, 3) + 3600_000, now)).toBe("Oct 3");
    expect(daysText(at(11, 30, 2025), at(0, 2), now)).toBe("Dec 30, 2025 – Jan 2");
  });
});

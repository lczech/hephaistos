import { afterEach, describe, expect, it, vi } from "vitest";
import { NOTICE_TIME, noticeAtom, notify } from "./notice";

describe("a notice", () => {
  afterEach(() => vi.useRealTimers());

  it("shows for a while, the latest instead of the one before", () => {
    vi.useFakeTimers();
    notify("Copied a");
    vi.advanceTimersByTime(NOTICE_TIME - 100);
    notify("Copied b");
    expect(noticeAtom.get()).toBe("Copied b");
    vi.advanceTimersByTime(NOTICE_TIME - 100);
    expect(noticeAtom.get()).toBe("Copied b");
    vi.advanceTimersByTime(200);
    expect(noticeAtom.get()).toBeNull();
  });
});

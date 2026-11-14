import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followToken, SETTLE } from "./tokenFile.js";

const FILE = "/data/token";

/** The token file, changed by hand, and what following it told. */
function followed() {
  const file = { text: "a" as string | null };
  let listener: ((event: string, name: string | null) => void) | undefined;
  const changed = vi.fn();
  followToken(FILE, changed, {
    watch: (directory, listening) => {
      expect(directory).toBe("/data");
      listener = listening;
    },
    read: () => file.text,
  });
  const write = (text: string | null) => {
    file.text = text;
    listener?.("change", "token");
  };
  const other = (text: string) => {
    file.text = text; // as if read now: only another file changed
    listener?.("change", "token.tmp");
  };
  return { write, other, changed };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("following the token file", () => {
  it("tells once its text changed, a moment after its last change", () => {
    const { write, changed } = followed();
    write("b");
    write("c"); // written in parts
    vi.advanceTimersByTime(SETTLE - 1);
    expect(changed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("tells nothing for the same text, or for another file", () => {
    const { write, other, changed } = followed();
    write("a"); // touched
    vi.advanceTimersByTime(SETTLE);
    other("b");
    vi.advanceTimersByTime(SETTLE);
    expect(changed).not.toHaveBeenCalled();
  });

  it("follows nothing where its directory is not yet", () => {
    const changed = vi.fn();
    const watch = () => {
      throw new Error("ENOENT");
    };
    expect(() => followToken(FILE, changed, { watch, read: () => null })).not.toThrow();
  });
});

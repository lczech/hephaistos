import { describe, expect, it } from "vitest";
import { addressText, asAddress, paramValues, parseAddress, withParam } from "./address";

describe("addresses", () => {
  it("are the kind, with parameters sorted", () => {
    expect(addressText({ kind: "daemon", params: {} })).toBe("daemon");
    expect(addressText({ kind: "events", params: { since: "2h", repository: "01" } })).toBe(
      "events?repository=01&since=2h",
    );
  });

  it("read back as they were written", () => {
    const address = { kind: "file", params: { path: "/a b/c~1.txt", line: "3" } };
    expect(parseAddress(addressText(address))).toEqual(address);
    expect(parseAddress("daemon")).toEqual({ kind: "daemon", params: {} });
  });

  it("aren't anything else", () => {
    expect(parseAddress("")).toBeNull();
    expect(parseAddress("Events")).toBeNull();
    expect(parseAddress("?repository=01")).toBeNull();
  });
});

describe("parameters with several values", () => {
  const kinds = { kind: "events", params: { since: "1d", kind: ["worktree", "clone"] } };

  it("repeat in the address, sorted, so the same ones always give the same", () => {
    expect(addressText(kinds)).toBe("events?kind=clone&kind=worktree&since=1d");
    expect(kinds.params.kind).toEqual(["worktree", "clone"]); // left as they were
    expect(addressText({ kind: "events", params: { kind: ["clone"] } })).toBe("events?kind=clone");
  });

  it("read back as a list", () => {
    expect(parseAddress("events?kind=clone&since=1d&kind=worktree")).toEqual({
      kind: "events",
      params: { kind: ["clone", "worktree"], since: "1d" },
    });
    expect(asAddress(JSON.parse(JSON.stringify(kinds)))).toEqual(kinds);
  });

  it("are set and read alike, however many", () => {
    expect(withParam({ since: "1d" }, "kind", ["clone", "worktree"])).toEqual({
      since: "1d",
      kind: ["clone", "worktree"],
    });
    expect(withParam({ since: "1d" }, "kind", ["clone"])).toEqual({ since: "1d", kind: "clone" });
    expect(withParam({ since: "1d", kind: "clone" }, "kind", [])).toEqual({ since: "1d" });
    expect(paramValues("clone")).toEqual(["clone"]);
    expect(paramValues(["clone", "worktree"])).toEqual(["clone", "worktree"]);
    expect(paramValues(undefined)).toEqual([]);
  });
});

describe("saved addresses", () => {
  it("are kept as they were", () => {
    const address = { kind: "events", params: { since: "1d" } };
    expect(asAddress(JSON.parse(JSON.stringify(address)))).toEqual(address);
  });

  it("aren't anything else", () => {
    for (const saved of [undefined, "events", { kind: "Events", params: {} }, { kind: "events" }]) {
      expect(asAddress(saved)).toBeNull();
    }
    expect(asAddress({ kind: "events", params: { since: 1 } })).toBeNull();
    expect(asAddress({ kind: "events", params: ["1d"] })).toBeNull();
    expect(asAddress({ kind: "events", params: { kind: ["clone", 1] } })).toBeNull();
  });
});

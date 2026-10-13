import { describe, expect, it } from "vitest";
import { addressText, asAddress, parseAddress } from "./address";

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
  });
});

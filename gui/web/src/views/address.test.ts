import { describe, expect, it } from "vitest";
import { addressText, panelAddress, panelId, parseAddress } from "./address";

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

describe("Panel IDs", () => {
  const file = { kind: "file", params: { path: "/notes~2" } };

  it("are the address, then which Panel showing it", () => {
    expect(panelId(file)).toBe("file?path=%2Fnotes%7E2");
    expect(panelId(file, 2)).toBe("file?path=%2Fnotes%7E2~2");
  });

  it("give the address back", () => {
    expect(panelAddress(panelId(file))).toEqual(file);
    expect(panelAddress(panelId(file, 2))).toEqual(file);
  });
});

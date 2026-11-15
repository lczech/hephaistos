import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { KEYS, QUERY_DEFAULTS, refreshChanges } from "./queries";

describe("refreshChanges", () => {
  it("asks again for a list and its folders, also when named by one of them", () => {
    const client = new QueryClient(QUERY_DEFAULTS);
    const own = { clone: "clone-proj", from: "HEAD", to: "index" };
    const within = [
      [...KEYS.changes, own],
      [...KEYS.changes, { ...own, path: "src/" }],
    ];
    const others = [
      [...KEYS.changes, { ...own, to: "working-tree" }],
      [...KEYS.changes, { clone: "clone-other", from: "HEAD", to: "index" }],
    ];
    for (const by of [own, { ...own, path: "src/" }]) {
      for (const key of [...within, ...others]) client.setQueryData(key, {});
      refreshChanges(client, by);
      for (const key of within) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      for (const key of others) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import { FakeSocket } from "./live";
import { json, serve } from "./server";

describe("tests reach no Server", () => {
  it("fails requests no test answers, also once its answers are gone", async () => {
    await expect(fetch("/api/info")).rejects.toThrow("no server in tests: /api/info");
    serve({ "GET /api/info": () => json({}) });
    expect((await fetch(new Request("http://localhost/api/info"))).status).toBe(200);
    vi.unstubAllGlobals(); // as after each test
    await expect(fetch("/api/info")).rejects.toThrow("answer it with serve()");
  });

  it("keeps live connections to itself", () => {
    expect(new WebSocket("ws://127.0.0.1:8264/api/live")).toBeInstanceOf(FakeSocket);
  });
});

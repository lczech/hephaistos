import { describe, expect, it } from "vitest";
import { json, serve } from "../test/server";
import { takeTokenFromUrl, token } from "../token";
import { ApiError, api, unwrap } from "./client";

/** The error `unwrap` throws for the Server's answer to `/api/info`. */
async function thrown(): Promise<unknown> {
  try {
    unwrap(await api.GET("/api/info"));
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("an answer other than success", () => {
  it("is an ApiError with our message, and the Checkout it is about", async () => {
    const checkout = { clone: "clone-proj", worktree: null, gone: "clone" } as const;
    serve({ "GET /api/info": () => json({ error: "the clone was removed", checkout }, 410) });
    const error = await thrown();
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 410, message: "the clone was removed", checkout });
  });

  it("not ours, e.g. a proxy, is an ApiError by its status, without a Checkout", async () => {
    serve({
      "GET /api/info": () =>
        new Response("<html>Bad Gateway</html>", {
          status: 502,
          statusText: "Bad Gateway",
          headers: { "Content-Type": "text/html" },
        }),
    });
    const error = await thrown();
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, message: "502 Bad Gateway", checkout: null });
  });
});

describe("a 401", () => {
  it("forgets the token it was sent, not a newer one come meanwhile", async () => {
    window.history.replaceState(null, "", "/#token=old");
    takeTokenFromUrl();
    let refuse = () => {};
    const sent: (string | null)[] = [];
    serve({
      "GET /api/info": (request) => {
        sent.push(request.headers.get("Authorization"));
        return new Promise((resolve) => {
          refuse = () => resolve(json({ error: "wrong token" }, 401));
        });
      },
    });
    const answer = api.GET("/api/info");
    await new Promise((resolve) => setTimeout(resolve)); // sent
    expect(sent).toEqual(["Bearer old"]);
    window.history.replaceState(null, "", "/#token=renewed");
    takeTokenFromUrl();
    refuse();
    await answer;
    expect(token()).toBe("renewed");
    const again = api.GET("/api/info");
    await new Promise((resolve) => setTimeout(resolve));
    refuse();
    await again;
    expect(token()).toBeNull(); // the one it sent, refused too
  });
});

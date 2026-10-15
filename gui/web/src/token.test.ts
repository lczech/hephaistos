import { describe, expect, it, vi } from "vitest";
import { followTokenLinks, forgetToken, subscribe, takeTokenFromUrl, token } from "./token";

describe("the token", () => {
  it("comes from a link's fragment, which leaves the address bar", () => {
    window.history.replaceState(null, "", "/?tab=1#token=abc-_9");
    takeTokenFromUrl();
    expect(token()).toBe("abc-_9");
    expect(localStorage.getItem("hephaistos.token")).toBe("abc-_9");
    expect(window.location.href).toBe(`${window.location.origin}/?tab=1`);
  });

  it("stays without one in the link", () => {
    window.history.replaceState(null, "", "/#token=abc");
    takeTokenFromUrl();
    window.history.replaceState(null, "", "/#elsewhere");
    takeTokenFromUrl();
    expect(token()).toBe("abc");
    expect(window.location.hash).toBe("#elsewhere");
  });

  it("is forgotten, telling those who listen", () => {
    window.history.replaceState(null, "", "/#token=abc");
    takeTokenFromUrl();
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    forgetToken();
    unsubscribe();
    expect(token()).toBeNull();
    expect(localStorage.getItem("hephaistos.token")).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("is forgotten only while it is the one refused", () => {
    window.history.replaceState(null, "", "/#token=new");
    takeTokenFromUrl();
    forgetToken("old");
    expect(token()).toBe("new");
    forgetToken("new");
    expect(token()).toBeNull();
  });

  it("comes from links opened in the page later", () => {
    followTokenLinks();
    window.history.replaceState(null, "", "/#token=later");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(token()).toBe("later");
    expect(window.location.hash).toBe("");
  });
});

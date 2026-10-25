import { describe, expect, it } from "vitest";
import { reason } from "./hephaistos.js";
import { waitingPage } from "./page.js";

const html = (url: string) => decodeURIComponent(url.slice(url.indexOf(",") + 1));

describe("the waiting page", () => {
  it("says the Daemon starts", () => {
    expect(html(waitingPage({ state: "starting" }))).toContain("<h1>Starting the daemon…</h1>");
  });

  it("says why it can't reach the Daemon, commands as code, and nothing runs", () => {
    const page = html(
      waitingPage({ state: "down", reason: "the daemon isn't installed; run `<b>hephaistos</b>`" }),
    );
    expect(page).toContain(
      "<p>The daemon isn't installed; run <code>&lt;b&gt;hephaistos&lt;/b&gt;</code>.</p>",
    );
    expect(page).toContain("default-src 'none'");
    expect(page).not.toContain("<script");
  });
});

describe("a failed command's reason", () => {
  it("is its error, without warnings after it", () => {
    const stderr = "error: the server isn't running\nwarning: cannot write the log\n";
    expect(reason(stderr, "exit 1")).toBe("the server isn't running");
    expect(reason("Traceback …\nKeyError: x\n", "exit 1")).toBe("KeyError: x");
    expect(reason("", "exit 1")).toBe("exit 1");
  });
});

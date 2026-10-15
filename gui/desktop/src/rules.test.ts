import { describe, expect, it } from "vitest";
import { destination, type Key, keyAction } from "./rules.js";

const SERVER = "http://127.0.0.1:8264";

describe("where the page may go", () => {
  it("stays on its Server, sends web pages to the browser, and nothing else anywhere", () => {
    expect(destination(`${SERVER}/#token=abc`, SERVER)).toBe("window");
    expect(destination("http://127.0.0.1:8299/", SERVER)).toBe("browser");
    expect(destination("https://github.com/x/y", SERVER)).toBe("browser");
    expect(destination("https://github.com/x/y", null)).toBe("browser");
    expect(destination("file:///etc/passwd", SERVER)).toBe("none");
    expect(destination("vscode://file/x", SERVER)).toBe("none");
    expect(destination("not a url", SERVER)).toBe("none");
  });
});

describe("the window's keys", () => {
  const key = (name: string, held: Partial<Key> = {}): Key => ({
    type: "keyDown",
    key: name,
    control: false,
    shift: false,
    alt: false,
    meta: false,
    ...held,
  });
  const control = { control: true };

  it("are reload, zoom, full screen, developer tools and quit", () => {
    expect(keyAction(key("r", control))).toBe("reload");
    expect(keyAction(key("F5"))).toBe("reload");
    expect(keyAction(key("=", control))).toBe("zoomIn");
    expect(keyAction(key("+", { control: true, shift: true }))).toBe("zoomIn");
    expect(keyAction(key("-", control))).toBe("zoomOut");
    expect(keyAction(key("0", control))).toBe("zoomReset");
    expect(keyAction(key("F11"))).toBe("fullScreen");
    expect(keyAction(key("I", { control: true, shift: true }))).toBe("devTools");
    expect(keyAction(key("q", control))).toBe("quit");
  });

  it("leave all others to the page", () => {
    expect(keyAction(key("w", control))).toBeNull();
    expect(keyAction(key("t", control))).toBeNull();
    expect(keyAction(key("r"))).toBeNull();
    expect(keyAction(key("r", { control: true, alt: true }))).toBeNull();
    expect(keyAction({ ...key("r", control), type: "keyUp" })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { allowed, destination, type Key, keyAction } from "./rules.js";

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

describe("what the page may ask for", () => {
  it("is copying, for its own page only", () => {
    expect(allowed("clipboard-sanitized-write", `${SERVER}/#token=abc`, SERVER)).toBe(true);
    expect(allowed("clipboard-sanitized-write", SERVER, SERVER)).toBe(true); // checks give origins
    expect(allowed("clipboard-sanitized-write", "http://127.0.0.1:8299/", SERVER)).toBe(false);
    expect(allowed("clipboard-sanitized-write", SERVER, null)).toBe(false);
    expect(allowed("clipboard-read", SERVER, SERVER)).toBe(false);
    expect(allowed("media", SERVER, SERVER)).toBe(false);
    expect(allowed("clipboard-sanitized-write", "not a url", SERVER)).toBe(false);
  });
});

describe("the window's keys", () => {
  const key = (name: string, held: Partial<Key> = {}): Key => ({
    type: "keyDown",
    key: name,
    code: name.length === 1 ? `Key${name.toUpperCase()}` : name,
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

  it("are the same with Caps Lock on, which turns the case of letters", () => {
    expect(keyAction(key("R", control))).toBe("reload");
    expect(keyAction(key("Q", control))).toBe("quit");
    expect(keyAction(key("i", { control: true, shift: true }))).toBe("devTools");
  });

  it("take the letter typed, or the place of the key where that letter is not Latin", () => {
    expect(keyAction({ ...key("к", control), code: "KeyR" })).toBe("reload"); // Cyrillic
    expect(keyAction({ ...key("Ш", { control: true, shift: true }), code: "KeyI" })).toBe(
      "devTools",
    );
    // AZERTY: the key in the place of Q types a, and that in the place of A types q.
    expect(keyAction({ ...key("a", control), code: "KeyQ" })).toBeNull();
    expect(keyAction({ ...key("q", control), code: "KeyA" })).toBe("quit");
  });

  it("leave all others to the page", () => {
    expect(keyAction(key("w", control))).toBeNull();
    expect(keyAction(key("t", control))).toBeNull();
    expect(keyAction(key("r"))).toBeNull();
    expect(keyAction(key("r", { control: true, alt: true }))).toBeNull();
    expect(keyAction({ ...key("r", control), type: "keyUp" })).toBeNull();
  });
});

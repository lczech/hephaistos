import { describe, expect, it } from "vitest";
import { paths } from "../../test/server";
import { pathRows } from "./paths";

describe("the rows of Paths", () => {
  it("give each directory under ~, with what it holds and its size", () => {
    const rows = pathRows(paths(), "/home/me");
    expect(rows.map((row) => [row.label, row.shown, row.holds])).toEqual([
      ["Code", "~/Repos/hephaistos", "the checkout hephaistos runs from"],
      ["Config", "~/.config/hephaistos", "config.toml, and config.<hostname>.toml for one machine"],
      ["Data", "~/.local/share/hephaistos/d1c604c9", "1.1 MB, the database and the server token"],
      [
        "Logs",
        "~/.local/state/hephaistos/d1c604c9",
        "844 kB of logs, and the files of the running daemon",
      ],
      [
        "App",
        "~/.local/state/hephaistos/d1c604c9/desktop",
        "534 MB, the browser profile of the desktop app, mostly caches",
      ],
    ]);
    expect(rows[0]?.path).toBe("/home/me/Repos/hephaistos"); // what Copy copies
  });

  it("say which is not there yet, and the code when installed, without sizes", () => {
    const unsized = paths(false);
    unsized.code = { ...unsized.code, path: "/usr/lib/hephaistos", checkout: false };
    unsized.desktop = { ...unsized.desktop, exists: false };
    const rows = pathRows(unsized, "/home/me");
    expect(rows.map((row) => row.holds)).toEqual([
      "the installed package",
      "config.toml, and config.<hostname>.toml for one machine",
      "the database and the server token",
      "the logs, and the files of the running daemon",
      "not there yet; the browser profile of the desktop app, mostly caches",
    ]);
    expect(rows[0]?.shown).toBe("/usr/lib/hephaistos");
  });
});

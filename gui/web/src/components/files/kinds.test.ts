import { describe, expect, it } from "vitest";
import { fileKind, LANGUAGES, settled, UNSETTLED } from "./kinds";
import linguist from "./linguist.json";

describe("a file's kind", () => {
  it("comes from our own names and extensions first", () => {
    expect(fileKind("README")).toBe("text");
    expect(fileKind("notes.md")).toBe("text");
    expect(fileKind("photo.JPG")).toBe("image");
    expect(fileKind("logo.svg")).toBe("image"); // data, to Linguist
    expect(fileKind("table.csv")).toBe("spreadsheet");
    expect(fileKind("backup.tar.gz")).toBe("archive");
    expect(fileKind("Cargo.lock")).toBe("lock"); // TOML, to Linguist
  });

  it("then from Linguist's names and extensions, by their language or its type", () => {
    expect(fileKind("Makefile")).toBe("code");
    expect(fileKind(".gitignore")).toBe("config");
    expect(fileKind("LICENSE")).toBe("text");
    expect(fileKind("main.py")).toBe("code");
    expect(fileKind("run.sh")).toBe("shell");
    expect(fileKind("package.json")).toBe("data");
    expect(fileKind("types.d.ts")).toBe("code");
  });

  it("takes Linguist's exact names before our extensions, but for locks and configs", () => {
    expect(fileKind("CMakeLists.txt")).toBe("code"); // not text, as .txt says
    expect(fileKind("requirements.txt")).toBe("data");
    expect(fileKind("notes.txt")).toBe("text");
    expect(fileKind("uv.lock")).toBe("lock"); // TOML, to Linguist
    expect(fileKind("yarn.lock")).toBe("lock"); // YAML, to Linguist
    expect(fileKind("nginx.conf")).toBe("config"); // data, to Linguist
  });

  it("is a plain file otherwise", () => {
    expect(fileKind("mystery")).toBe("file");
    expect(fileKind(".hidden")).toBe("file");
  });
});

describe("Linguist's data", () => {
  it("names the languages we show by their own kind", () => {
    expect(Object.keys(LANGUAGES).filter((name) => !(name in linguist.types))).toEqual([]);
  });

  // An update of Linguist that leaves more extensions to us fails here, to decide them.
  it("leaves to us only these extensions, which our table does not all settle", () => {
    expect(UNSETTLED.filter((extension) => !settled(extension))).toEqual([
      ".asy",
      ".bs",
      ".bst",
      ".cue",
      ".ddl",
      ".dsc",
      ".dsp",
      ".frm",
      ".gml",
      ".gst",
      ".ks",
      ".mc",
      ".mod",
      ".msg",
      ".nb",
      ".nl",
      ".odin",
      ".pc",
      ".pkl",
      ".pluginspec",
      ".prc",
      ".pro",
      ".scd",
      ".sip",
      ".srt",
      ".st",
      ".svx",
      ".tl",
      ".tsp",
      ".workflow",
      ".x",
      ".yy",
    ]);
  });
});

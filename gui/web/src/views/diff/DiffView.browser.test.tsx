import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type CSSProperties, useState } from "react";
import { describe, expect, it } from "vitest";
import type { Schemas } from "../../api/client";
import { diffRows, lineCount } from "../../components/diff/height";
import { json, renderWithQueries, serve } from "../../test/server";
import type { Params } from "../address";
import { DiffView } from "./DiffView";
import styles from "./DiffView.module.css";

// What the renderer draws, as a browser lays it out: guards against its upgrades, of what the
// GUI counts on but the renderer doesn't promise.

/** A text of `count` lines, those `changed` in capitals. */
function text(count: number, changed: number[] = []): string {
  const line = (at: number) => (changed.includes(at) ? `LINE ${at}` : `line ${at}`);
  return Array.from({ length: count }, (_, at) => `${line(at + 1)}\n`).join("");
}

/** git's patch of a file, of hunks each changing a line, with 3 lines around it. */
function patchOf(path: string, count: number, changed: number[]): string {
  const hunks = changed.map((at) => {
    const from = Math.max(1, at - 3);
    const to = Math.min(count, at + 3);
    const lines = [];
    for (let line = from; line <= to; line++) {
      lines.push(...(line === at ? [`-line ${line}`, `+LINE ${line}`] : [` line ${line}`]));
    }
    return `@@ -${from},${to - from + 1} +${from},${to - from + 1} @@\n${lines.join("\n")}\n`;
  });
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${hunks.join("")}`;
}

/** git's patch of a new file. */
function added(path: string, count: number): string {
  const lines = text(count).replace(/^/gm, "+").slice(0, -1);
  return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${count} @@\n${lines}`;
}

interface File {
  status: "A" | "M";
  patch: string;
  old: string | null;
  new: string;
}

/** A changed file: its lines changed, of so many, and its two versions. */
function changed(path: string, count: number, lines: number[]): File {
  return {
    status: "M",
    patch: patchOf(path, count, lines),
    old: text(count),
    new: text(count, lines),
  };
}

/** The Server, answering for these files changed since HEAD; returns the paths whose diffs were asked. */
function serveFiles(files: Record<string, File>): string[] {
  const asked: string[] = [];
  const change = (path: string): Schemas["ChangeJson"] => ({
    path,
    status: files[path]?.status ?? "M",
    original: null,
    added: 1,
    removed: 1,
    binary: false,
    size: null,
    old_size: null,
    files: null,
    more_files: false,
  });
  const paths = Object.keys(files);
  const pathOf = (request: Request) => new URL(request.url).searchParams.get("path") ?? "";
  serve({
    "GET /api/changes": () =>
      json({
        branch: null,
        groups: [
          {
            name: "changes",
            from: "HEAD",
            to: "working-tree",
            count: paths.length,
            changes: paths.map(change),
          },
        ],
        commit: null,
      }),
    "GET /api/diff": (request) => {
      asked.push(pathOf(request));
      return json({ change: change(pathOf(request)), patch: files[pathOf(request)]?.patch });
    },
    "GET /api/diff/files": (request) => {
      const file = files[pathOf(request)];
      return json({ old: file?.old, new: file?.new });
    },
    "GET /api/config": () =>
      json({ host: "laptop", settings: [], sources: [], other_hosts: [], unknown_variables: [] }),
  });
  return asked;
}

const SINCE_HEAD = { clone: "clone-proj", from: "HEAD", to: "working-tree" };

/** The View, of all files unless of one (`path`), in a Panel of this size. */
function renderDiff(size: CSSProperties, path?: string, at: Params = {}) {
  function Panel() {
    const [params, setParams] = useState<Params>({ ...SINCE_HEAD, ...(path && { path }) });
    const [fragment, setFragment] = useState<Params>(at);
    return (
      <div data-testid="panel" style={size}>
        <DiffView
          params={params}
          setParams={setParams}
          fragment={fragment}
          setFragment={setFragment}
          endTyping={() => {}}
          setTitle={() => {}}
        />
      </div>
    );
  }
  return renderWithQueries(<Panel />);
}

/** A file's diff once the renderer has drawn it. */
async function drawn(path: string): Promise<HTMLElement> {
  return waitFor(
    () => {
      // Below its header: what holds its place, around what the renderer draws.
      const section = screen.getByRole("region", { name: path });
      const body = section.lastElementChild?.firstElementChild;
      if (!(body instanceof HTMLElement)) throw new Error(`${path}: not given to the renderer`);
      expect(body.getBoundingClientRect().height).toBeGreaterThan(0);
      return body;
    },
    { timeout: 10_000 },
  );
}

/** The text of what a highlight of the page marks: matches found, or the current one. */
function marked(name: "hephaistos-found" | "hephaistos-found-current"): string[] {
  return [...(CSS.highlights.get(name) ?? [])].map((range) => (range as Range).toString());
}

/** One file's diff once the renderer has drawn it: its element. */
async function drawnAlone(path: string): Promise<HTMLElement> {
  return waitFor(
    () => {
      const diff = screen.getByRole("region", { name: path }).querySelector("diffs-container");
      if (!(diff instanceof HTMLElement)) throw new Error(`${path}: not drawn`);
      expect(diff.getBoundingClientRect().height).toBeGreaterThan(0);
      return diff;
    },
    { timeout: 10_000 },
  );
}

/** The find bar's count: `3 of 12`. */
const count = () => screen.getByLabelText("Find", { selector: "search" }).querySelector("output");

describe("finding in a file's diff", () => {
  // A change every 10 lines: a stack of hunks far longer than the Panel.
  const MANY = changed(
    "f.txt",
    300,
    Array.from({ length: 28 }, (_, at) => 20 + at * 10),
  );

  it("marks the matches drawn, the current one apart", async () => {
    serveFiles({ "f.txt": MANY });
    renderDiff({ width: 1000, height: 600 }, "f.txt", { find: "LINE", case: "1" });
    const diff = await drawnAlone("f.txt");
    await waitFor(() => expect(count()).toHaveTextContent("1 of 28"));
    await waitFor(() => expect(marked("hephaistos-found-current")).toEqual(["LINE"]));
    // Its line too, as the renderer marks lines selected: side by side, its row.
    const selected = diff.shadowRoot?.querySelectorAll("[data-line][data-selected-line]") ?? [];
    expect([...selected].map((line) => line.textContent)).toEqual(["line 20", "LINE 20"]);
    // The others drawn, those near it: not all of them, far further down.
    const others = marked("hephaistos-found");
    expect(others.length).toBeGreaterThan(0);
    expect(others.length).toBeLessThan(27);
    expect(new Set(others)).toEqual(new Set(["LINE"]));
  });

  it("brings a match it steps to into view, also one not drawn yet", async () => {
    serveFiles({ "f.txt": MANY });
    renderDiff({ width: 1000, height: 600 }, "f.txt", { find: "LINE 290", case: "1" });
    await drawnAlone("f.txt");
    const scroller = screen
      .getByRole("region", { name: "f.txt" })
      .parentElement?.closest("[class*=diff]") as HTMLElement;
    await waitFor(() => expect(marked("hephaistos-found-current")).toEqual(["LINE 290"]));
    // Drawn a little ahead of the view: in it once scrolled.
    await waitFor(() => {
      const [range] = [...(CSS.highlights.get("hephaistos-found-current") ?? [])] as Range[];
      const line = range?.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      expect(line?.top).toBeGreaterThan(view.top);
      expect(line?.bottom).toBeLessThan(view.bottom);
    });
  });

  it("counts the lines a band opens", async () => {
    // `line 2` alone: before the hunk at 20, in the band of lines left out above it.
    serveFiles({ "f.txt": changed("f.txt", 40, [20]) });
    renderDiff({ width: 1000, height: 600 }, "f.txt", { find: "line 2", word: "1" });
    const diff = await drawnAlone("f.txt");
    await waitFor(() => expect(count()).toHaveTextContent("No results"));
    const band = diff.shadowRoot?.querySelector<HTMLElement>("[data-expand-button]");
    band?.click();
    await waitFor(() => expect(count()).toHaveTextContent("1 of 1"));
    // Unchanged, on both sides.
    await waitFor(() => expect(marked("hephaistos-found-current")).toEqual(["line 2", "line 2"]));
  });
});

describe("the renderer draws a diff", () => {
  it("as high as its place was held", async () => {
    const files: Record<string, File> = {
      "new.txt": { status: "A", patch: added("new.txt", 20), old: null, new: text(20) },
      "middle.txt": changed("middle.txt", 40, [20]),
      "two.txt": changed("two.txt", 40, [10, 30]),
      "start.txt": changed("start.txt", 40, [2]),
      "end.txt": changed("end.txt", 40, [39]),
      "whole.txt": changed("whole.txt", 7, [4]),
    };
    serveFiles(files);
    const look = { split: true, wrap: false, whole: false };
    renderDiff({ width: 1000, height: 3000 });
    for (const [path, file] of Object.entries(files)) {
      const body = await drawn(path);
      // The place held for it, as `FileBody` sizes it.
      const known = file.status === "A" ? undefined : lineCount(file.new);
      const { rows, bands, ends } = diffRows(file.patch, look, known);
      const held = document.createElement("div");
      held.className = styles.waiting ?? "";
      held.style.cssText = `--rows: ${rows}; --bands: ${bands}; --ends: ${ends}`;
      body.after(held);
      expect(body.getBoundingClientRect().height, path).toBe(held.getBoundingClientRect().height);
      held.remove();
    }
  });

  it("only as it comes near in the element that scrolls", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 30 }, (_, at) => [`f${at}.txt`, changed(`f${at}.txt`, 40, [20])]),
    );
    const asked = serveFiles(files);
    renderDiff({ width: 1000, height: 600 });
    await drawn("f0.txt");
    expect(asked).not.toContain("f29.txt");
    screen.getByRole("region", { name: "f29.txt" }).scrollIntoView();
    await drawn("f29.txt");
  });

  it("collapsed when scrolled past its top, keeping its header where it was", async () => {
    // Files enough below it to stay scrolled so once it is collapsed.
    const below = Array.from({ length: 10 }, (_, at) => [
      `b${at}.txt`,
      changed(`b${at}.txt`, 40, [20]),
    ]);
    serveFiles({ "a.txt": changed("a.txt", 400, [100, 200, 300]), ...Object.fromEntries(below) });
    renderDiff({ width: 1000, height: 600 });
    const body = await drawn("a.txt");
    body.scrollIntoView({ block: "center" }); // its header stuck at the top
    const section = screen.getByRole("region", { name: "a.txt" });
    const header = section.firstElementChild as HTMLElement;
    const top = header.getBoundingClientRect().top;
    expect(section.getBoundingClientRect().top).toBeLessThan(top);
    await userEvent.click(within(section).getByRole("button", { name: "Diff of a.txt" }));
    expect(header.getBoundingClientRect().top).toBeCloseTo(top, 0); // scrolled by whole pixels
  });

  it("inline in a narrow Panel, and as it was while hidden", async () => {
    serveFiles({ "a.txt": changed("a.txt", 40, [20]) });
    renderDiff({ width: 1000, height: 600 });
    const body = await drawn("a.txt");
    const style = () =>
      body.querySelector("diffs-container")?.shadowRoot?.querySelector("pre")?.dataset.diffType;
    expect(style()).toBe("split");
    const panel = screen.getByTestId("panel");
    const resize = (change: Partial<CSSStyleDeclaration>) =>
      act(async () => {
        Object.assign(panel.style, change);
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      });
    await resize({ width: "500px" });
    await waitFor(() => expect(style()).not.toBe("split"));
    await resize({ width: "1000px" });
    await waitFor(() => expect(style()).toBe("split"));
    await resize({ display: "none" }); // e.g. in a tab not shown: not drawn anew
    await resize({ display: "" });
    expect(style()).toBe("split");
  });
});

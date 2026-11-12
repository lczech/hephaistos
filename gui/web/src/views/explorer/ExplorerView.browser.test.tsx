import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { Schemas } from "../../api/client";
import {
  clone,
  fileEntry,
  info,
  json,
  renderWithQueries,
  repository,
  serve,
} from "../../test/server";
import { InPanel } from "../../test/view";
import { ExplorerView } from "./ExplorerView";
import type { FileEntry } from "./rows";

// How the Explorer's tree lays out, as a browser draws it: what was wrong once, seen only there.

const folder = (name: string, items: number) => fileEntry(name, { kind: "directory", items });

/** A Checkout at /r: a folder holding a folder of many files, and files of some sizes. */
const DISK: Record<string, FileEntry[]> = {
  "/r": [
    folder("a", 2),
    fileEntry("small.txt", { size: 486 }),
    fileEntry("big.txt", { size: 19_000 }),
    fileEntry("README.md", { size: 5, status: "M", worktree: "M" }),
  ],
  "/r/a": [folder("b", 40), fileEntry("a1.txt", { size: 1 })],
  "/r/a/b": Array.from({ length: 40 }, (_, at) =>
    fileEntry(`f${String(at).padStart(2, "0")}.txt`, { size: at }),
  ),
};

function serveDisk() {
  serve({
    "GET /api/info": () => json(info()),
    "GET /api/repositories": () =>
      json([repository("r", [{ ...clone("r"), path: "/r", resolved_path: "/r" }])]),
    "GET /api/files": (request) => {
      const query = new URL(request.url).searchParams;
      const path = query.get("path") ?? "";
      const fields = new Set(query.getAll("fields"));
      const entries = (DISK[path] ?? []).map((found) => ({
        ...found,
        size: fields.has("size") ? found.size : null,
        items: fields.has("size") ? found.items : null,
        status: fields.has("git") ? found.status : null,
        worktree: fields.has("git") ? found.worktree : null,
      }));
      const answer: Schemas["FilesJson"] = {
        path,
        top: fields.has("git") ? "/r" : null,
        entries,
        count: entries.length,
      };
      return json(answer);
    },
    "GET /api/files/paths": () => {
      const below = (path: string, prefix: string): string[] =>
        (DISK[path] ?? []).flatMap((found) =>
          found.kind === "directory"
            ? [
                `${prefix}${found.name}/`,
                ...below(`${path}/${found.name}`, `${prefix}${found.name}/`),
              ]
            : [`${prefix}${found.name}`],
        );
      const answer: Schemas["PathsJson"] = {
        path: "/r",
        paths: below("/r", "").sort(),
        stopped: null,
        limit: null,
      };
      return json(answer);
    },
  });
}

/** The Explorer at /r, in a Panel this large, all its columns shown. */
async function explorer(width = 700, height = 320) {
  localStorage.setItem("hephaistos.lists.explorer.hidden", "[]");
  serveDisk();
  renderWithQueries(
    <div style={{ width, height, display: "flex", flexDirection: "column" }}>
      <InPanel view={ExplorerView} kind="explorer" params={{ path: "/r" }} />
    </div>,
  );
  await screen.findByText("README.md");
}

const rowOf = (name: string) =>
  [...document.querySelectorAll("[role=row]")].find(
    (item) => item.querySelector(":scope > div bdi")?.textContent === name,
  )?.firstElementChild as HTMLElement;

const box = (element: Element | null | undefined) => {
  if (!element) throw new Error("not shown");
  return element.getBoundingClientRect();
};

/** Where an element's first text ends, as drawn. */
function textEnd(element: Element): number {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = new Range();
  range.selectNodeContents(walker.nextNode() as Node);
  return range.getBoundingClientRect().right;
}

describe("the Explorer's tree, as drawn", () => {
  it("lines up sizes' and folders' numbers at their end", async () => {
    await explorer();
    const size = (name: string) => rowOf(name).querySelector("[data-column=size]") as Element;
    await waitFor(() => expect(size("a").textContent).toBe("2 items"));
    const ends = ["a", "small.txt", "big.txt"].map((name) => textEnd(size(name)));
    for (const end of ends) expect(end).toBeCloseTo(ends[0] as number, 0);
  });

  it("starts a row's icon where its parent's name does, its guides short of its chevron", async () => {
    await explorer();
    await userEvent.click(screen.getByText("a"));
    await userEvent.click(await screen.findByText("b"));
    await screen.findByText("f00.txt");
    const [a, b, f] = [rowOf("a"), rowOf("b"), rowOf("f00.txt")];
    expect(box(b.querySelector("[data-column=name] svg")).left).toBeCloseTo(
      box(a.querySelector("bdi")).left,
      0,
    );
    const chevron = box(b.querySelector("svg"));
    const guides = box(b.querySelector("[aria-hidden=true]:not(svg)"));
    expect(guides.right).toBeLessThanOrEqual(chevron.left);
    // A file two levels in has a line below each chevron it is within, the last below b's.
    const lines = box(f.querySelector("[aria-hidden=true]:not(svg)"));
    expect(lines.right).toBeGreaterThan(chevron.left);
    expect(lines.right).toBeLessThan(chevron.right);
  });

  it("shows the guides of rows within folders only while the pointer is over the list", async () => {
    await explorer();
    await userEvent.click(screen.getByText("a"));
    await screen.findByText("a1.txt");
    const guides = rowOf("a1.txt").querySelector("[aria-hidden=true]:not(svg)") as HTMLElement;
    await userEvent.unhover(rowOf("a1.txt"));
    await expect.poll(() => getComputedStyle(guides).opacity).toBe("0");
    await userEvent.hover(rowOf("README.md"));
    await expect.poll(() => getComputedStyle(guides).opacity).toBe("1");
  });

  it("keeps open folders in view below the header, deeper ones below and under them", async () => {
    await explorer();
    await userEvent.click(screen.getByText("a"));
    await userEvent.click(await screen.findByText("b"));
    await screen.findByText("f00.txt");
    const head = document.querySelector("[data-column]")?.parentElement as HTMLElement;
    let scroller: HTMLElement | null = head;
    while (scroller && getComputedStyle(scroller).overflowY === "visible") {
      scroller = scroller.parentElement;
    }
    (scroller as HTMLElement).scrollTop = 10_000;
    await waitFor(() => expect(box(rowOf("f39.txt")).bottom).toBeLessThan(box(scroller).bottom));
    // As seen: the rows stuck are copies, drawn apart above the rows, far above, not drawn.
    const stuck = (name: string) =>
      within(document.querySelector("[aria-hidden] [role=row]")?.parentElement as HTMLElement)
        .getByText(name)
        .closest("[role=row]") as HTMLElement;
    const [a, b] = [stuck("a"), stuck("b")];
    expect(box(a).top).toBeCloseTo(box(head).bottom, 0);
    expect(box(b).top).toBeCloseTo(box(a).bottom, 0);
    const z = (element: Element) => Number(getComputedStyle(element).zIndex);
    const strip = a.parentElement as HTMLElement;
    expect(z(head)).toBeGreaterThan(z(strip));
    expect(z(a)).toBeGreaterThan(z(b));
  });

  it("shows a row's links after its name, clear of its git letter", async () => {
    await explorer();
    const row = rowOf("README.md");
    await waitFor(() => expect(row.querySelector("[data-column=git]")?.textContent).toBe("M"));
    await userEvent.hover(row.querySelector("bdi") as Element);
    const diff = await screen.findByRole("button", { name: "Diff of README.md" });
    await waitFor(() => expect(getComputedStyle(diff).visibility).toBe("visible"));
    expect(box(diff).right).toBeLessThanOrEqual(box(row.querySelector("[data-column=git]")).left);
    expect(box(diff).left).toBeGreaterThanOrEqual(box(row.querySelector("bdi")).left);
  });

  it("hides a row's links once the pointer left it, also after a press dragged off them", async () => {
    await explorer();
    const row = rowOf("README.md");
    await waitFor(() => expect(row.querySelector("[data-column=git]")?.textContent).toBe("M"));
    await userEvent.hover(row.querySelector("bdi") as Element);
    const diff = await screen.findByRole("button", { name: "Diff of README.md" });
    await userEvent.dragAndDrop(diff, rowOf("small.txt").querySelector("bdi") as Element);
    await waitFor(() => expect(diff.checkVisibility()).toBe(false));
  });

  it("centres git's letters in their column", async () => {
    await explorer();
    const cell = rowOf("README.md").querySelector("[data-column=git]") as Element;
    await waitFor(() => expect(cell.textContent).toBe("M"));
    const letter = new Range();
    letter.selectNodeContents(cell);
    const middle = (rect: DOMRect) => (rect.left + rect.right) / 2;
    // Rows are drawn once the browser finds them in view (`content-visibility`), WebKit's later.
    await waitFor(() =>
      expect(middle(letter.getBoundingClientRect())).toBeCloseTo(middle(box(cell)), 0),
    );
  });

  it("keeps its path in place when its buttons wrap below it", async () => {
    const where = async (width: number) => {
      document.body.replaceChildren();
      await explorer(width);
      const part = screen.getByRole("button", { name: "r" });
      const bar = part.closest("header") as HTMLElement;
      const buttons = screen.getByRole("button", { name: "Hidden files" });
      return { path: box(part).top - box(bar).top, wrapped: box(buttons).top > box(part).bottom };
    };
    const wide = await where(700);
    const narrow = await where(140);
    expect([wide.wrapped, narrow.wrapped]).toEqual([false, true]);
    expect(narrow.path).toBeCloseTo(wide.path, 0);
  });

  it("keeps its find row in one line where it fits, its field narrower", async () => {
    await explorer(480);
    await userEvent.click(screen.getByRole("button", { name: "Find files and folders by name" }));
    await userEvent.keyboard("missing");
    const row = document.querySelector("search") as HTMLElement;
    await waitFor(() => expect(row.querySelector("output")?.textContent).not.toBe(""));
    const boxes = [...row.children].map(box);
    // On one line: each overlaps all others from top to bottom.
    expect(Math.max(...boxes.map(({ top }) => top))).toBeLessThan(
      Math.min(...boxes.map(({ bottom }) => bottom)),
    );
  });
});

describe("the Explorer's find, as drawn", () => {
  it("brings the match found into view, below the folders stuck, far from the view", async () => {
    await explorer();
    await userEvent.click(screen.getByRole("button", { name: "Find files and folders by name" }));
    await userEvent.keyboard("f");
    await waitFor(() => expect(rowOf("f00.txt")).toBeDefined());
    // From the first match round to the last, far below the view.
    await userEvent.click(screen.getByRole("button", { name: "Previous match" }));
    const frame = document.querySelector("[data-tree]") as HTMLElement;
    await waitFor(() => {
      const found = box(rowOf("f39.txt"));
      const stuck = [...document.querySelectorAll("[aria-hidden] [role=row]")].map(box);
      expect(stuck.length).toBe(2); // a and b
      expect(found.top).toBeGreaterThanOrEqual(Math.max(...stuck.map((at) => at.bottom)) - 1);
      expect(found.bottom).toBeLessThanOrEqual(box(frame).bottom + 1);
    });
  });

  it("asks what a folder holding matches holds once its row comes into view", async () => {
    const folders = Array.from({ length: 60 }, (_, at) => `d${String(at).padStart(2, "0")}`);
    const asked: string[] = [];
    serve({
      "GET /api/info": () => json(info()),
      "GET /api/repositories": () => json([]),
      "GET /api/files": (request) => {
        const path = new URL(request.url).searchParams.get("path") ?? "";
        asked.push(path);
        const name = path.split("/").at(-1) ?? "";
        const entries =
          path === "/s"
            ? folders.map((folder) => fileEntry(folder, { kind: "directory" }))
            : [fileEntry(`x${name}.txt`)];
        return json({ path, top: null, entries, count: entries.length });
      },
      "GET /api/files/paths": () =>
        json({
          path: "/s",
          paths: folders.flatMap((folder) => [`${folder}/`, `${folder}/x${folder}.txt`]),
          stopped: null,
          limit: null,
        }),
    });
    renderWithQueries(
      <div style={{ width: 700, height: 320, display: "flex", flexDirection: "column" }}>
        <InPanel view={ExplorerView} kind="explorer" params={{ path: "/s" }} />
      </div>,
    );
    await screen.findByText("d00");
    await userEvent.click(screen.getByRole("button", { name: "Find files and folders by name" }));
    await userEvent.keyboard("x");
    await waitFor(() => expect(rowOf("xd00.txt")).toBeDefined()); // its "x" marked
    await new Promise((done) => setTimeout(done, 500)); // what the rows in view ask for, answered
    const inside = () => new Set(asked.filter((path) => path !== "/s"));
    expect(inside().size).toBeGreaterThan(0);
    expect(inside().size).toBeLessThan(30); // of 60: those in view, or near it
    expect(inside().has("/s/d59")).toBe(false);
    const frame = document.querySelector("[data-tree]") as HTMLElement;
    frame.scrollTop = frame.scrollHeight;
    await waitFor(() => expect(inside().has("/s/d59")).toBe(true));
  });
});

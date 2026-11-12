import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { Schemas } from "../../api/client";
import { ownRow } from "../../test/list";
import { fileEntry, info, json, renderWithQueries, serve } from "../../test/server";
import { expectSettled, InPanel } from "../../test/view";
import type { Params } from "../address";
import { ExplorerView } from "./ExplorerView";
import type { FileEntry } from "./rows";

const entry = fileEntry;
const folder = (name: string) => entry(name, { kind: "directory" });

/** A disk, by folder: what each holds. */
const DISK: Record<string, FileEntry[]> = {
  "/home/me": [folder("proj"), folder("deep"), entry(".bashrc"), entry("notes.md")],
  "/home/me/proj": [entry("main.py"), entry("old", { kind: "symlink", target: "gone" })],
  "/home/me/deep": [folder("inner")],
  "/home/me/deep/inner": [entry("x.txt")],
};

/** Every path below a folder of the disk, as the Server lists them: folders ending in `/`. */
function pathsBelow(path: string, prefix = ""): string[] {
  return (DISK[path] ?? []).flatMap((found) =>
    found.kind === "directory"
      ? [
          `${prefix}${found.name}/`,
          ...pathsBelow(`${path}/${found.name}`, `${prefix}${found.name}/`),
        ]
      : [`${prefix}${found.name}`],
  );
}

interface Serving {
  refused?: boolean; // the listing of paths, with 403
  paths?: string[]; // listed instead of the disk's
  stopped?: Pick<Schemas["PathsJson"], "stopped" | "limit">; // why the listing stopped
  wait?: (query: URLSearchParams) => Promise<void> | undefined; // before it answers
}

/** Serves the disk, its paths listed as `serving` says. */
function serveDisk({ refused = false, paths, stopped, wait }: Serving = {}): Request[] {
  return serve({
    "GET /api/info": () => json(info()),
    "GET /api/repositories": () => json([]),
    "GET /api/files": (request) => {
      const path = new URL(request.url).searchParams.get("path") ?? "";
      const entries = DISK[path] ?? [];
      return json({ path, top: null, entries, count: entries.length });
    },
    "GET /api/files/paths": async (request) => {
      const query = new URL(request.url).searchParams;
      const path = query.get("path") ?? "";
      await wait?.(query);
      if (refused) return json({ error: `not allowed to list ${path}`, checkout: null }, 403);
      const all = paths ?? pathsBelow(path);
      const hidden = query.get("hidden") !== "false";
      const answer: Schemas["PathsJson"] = {
        path,
        paths: all
          .filter((found) => hidden || !found.split("/").some((part) => part.startsWith(".")))
          .sort(),
        stopped: stopped?.stopped ?? null,
        limit: stopped?.limit ?? null,
      };
      return json(answer);
    },
  });
}

/** A promise, and a way to settle it: to answer a request when a test says. */
function held(): { promise: Promise<void>; release: () => void } {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** The rows' names each time the tree changed, from now, until `stop`. */
function watchNames(): { seen: string[][]; stop: () => void } {
  const seen: string[][] = [];
  const observer = new MutationObserver(() =>
    seen.push(
      screen
        .queryAllByRole("listitem")
        .map((row) => ownRow(row).textContent?.replace(/\s+/g, " ").trim() ?? ""),
    ),
  );
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  return { seen, stop: () => observer.disconnect() };
}

/** Adds an entry to the home directory for this test only, a folder holding `entries`, if given. */
function addToHome(added: FileEntry, entries?: FileEntry[]) {
  const home = DISK["/home/me"] ?? [];
  home.unshift(added);
  if (entries) DISK[`/home/me/${added.name}`] = entries;
  onTestFinished(() => {
    home.splice(home.indexOf(added), 1);
    delete DISK[`/home/me/${added.name}`];
  }); // also once timed out, before the next test
}

const names = () =>
  screen
    .getAllByRole("listitem")
    .map((row) => ownRow(row).textContent?.replace(/\s+/g, " ").trim());

const field = () => screen.getByRole("textbox", { name: "Find files and folders by name" });

/** Shows the Explorer at `path`, its find row opened, `text` typed, if any. */
async function finding(text: string, initial: Params = { path: "/home/me" }) {
  return opened(initial, async () => {
    await userEvent.click(screen.getByRole("button", { name: "Find files and folders by name" }));
    if (text) await userEvent.type(field(), text);
  });
}

/** Shows the Explorer at `path`, the fragment as given, then does `then`, once it shows rows. */
async function opened(initial: Params, then?: () => Promise<void>, fragment?: Params) {
  const shown = renderWithQueries(
    <InPanel view={ExplorerView} kind="explorer" params={initial} fragment={fragment} />,
  );
  await waitFor(() => expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0));
  await then?.();
  return shown;
}

/** The find row's status, once it says which match of how many, or why none. */
const status = () => document.querySelector("search output");

describe("finding in the Explorer", () => {
  const scrolled = vi.fn<(this: Element) => void>();
  beforeEach(() => {
    scrolled.mockReset();
    Element.prototype.scrollIntoView = scrolled; // jsdom lays nothing out
  });

  it("shows matches in the folders holding them, marked, revealing the one found once closed", async () => {
    serveDisk();
    await finding("ma");
    await waitFor(() => expect(names()).toEqual(["proj", "main.py"]));
    expect(screen.getByText("ma").tagName).toBe("MARK");
    expect(status()).toHaveTextContent("1 of 1");
    await expectSettled();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(names()).toEqual(["deep", "proj", "main.py", "old", ".bashrc", "notes.md"]),
    );
    expect(screen.getByText("main.py").closest("[data-current]")).not.toBeNull();
    expect(scrolled.mock.contexts.at(-1)).toHaveTextContent("main.py");
  });

  it("steps through matches in the tree's order, opening the folder stepped into", async () => {
    serveDisk();
    await finding("m");
    await waitFor(() => expect(status()).toHaveTextContent("1 of 2"));
    expect(document.querySelector("[data-current]")).toHaveTextContent("main.py");
    await userEvent.click(screen.getByRole("button", { name: "Close all folders" }));
    expect(names()).toEqual(["proj", "notes.md"]); // the search's folders folded
    const next = screen.getByRole("button", { name: "Next match" });
    await userEvent.click(next);
    await waitFor(() => expect(status()).toHaveTextContent("2 of 2"));
    expect(document.querySelector("[data-current]")).toHaveTextContent("notes.md");
    await userEvent.click(next); // round to the first, its folder opened again
    await waitFor(() => expect(names()).toEqual(["proj", "main.py", "notes.md"]));
  });

  it("starts a search typed anew with its folders open, as folded for the one before", async () => {
    serveDisk();
    await finding("m");
    await waitFor(() => expect(names()).toEqual(["proj", "main.py", "notes.md"]));
    await userEvent.click(screen.getByRole("button", { name: "Close all folders" }));
    expect(names()).toEqual(["proj", "notes.md"]);
    await userEvent.type(field(), "a");
    await waitFor(() => expect(names()).toEqual(["proj", "main.py"]));
  });

  it("matches paths where what is typed has a `/`, and folders, opening to all they hold", async () => {
    serveDisk();
    await finding("proj/ma");
    await waitFor(() => expect(names()).toEqual(["proj", "main.py"]));
    await userEvent.clear(field());
    await userEvent.type(field(), "proj");
    await waitFor(() => expect(names()).toEqual(["proj"]));
    await expectSettled(); // the search typed done, which would fold what it opens
    await userEvent.click(screen.getByText("proj"));
    await waitFor(() => expect(names()).toEqual(["proj", "main.py", "old"]));
  });

  it("leaves hidden files out while they are, and folders unjoined", async () => {
    const requests = serveDisk();
    await finding("bash");
    await waitFor(() => expect(names()).toEqual([".bashrc"]));
    await userEvent.click(screen.getByRole("button", { name: "Hidden files" }));
    await waitFor(() => expect(screen.getByText("No files or folders found.")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Hidden files" })); // as it was
    await userEvent.clear(field());
    await userEvent.type(field(), "x");
    await waitFor(() => expect(names()).toEqual(["deep", "inner", "x.txt"])); // not joined
    const listed = requests
      .filter((request) => request.url.includes("/api/files/paths"))
      .map((request) => new URL(request.url).searchParams.get("hidden"));
    expect(listed).toEqual(["true", "false"]); // the first answer kept for showing them again
  });

  it("searches another Directory shown in its place", async () => {
    serveDisk();
    await finding("x", { path: "/home/me/proj" });
    await waitFor(() => expect(screen.getByText("No files or folders found.")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "~" }));
    await waitFor(() => expect(names()).toEqual(["deep", "inner", "x.txt"]));
    expect(field()).toHaveValue("x");
  });

  it("reveals what it found only below the Directory it found it in", async () => {
    addToHome(folder("inner"), [entry("x.txt")]); // as in deep/: the same path below another
    serveDisk();
    await finding("x", { path: "/home/me/deep" });
    await waitFor(() => expect(names()).toEqual(["inner", "x.txt"]));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(document.querySelector("[data-current]")).not.toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "~" }));
    await userEvent.click(await screen.findByText("inner"));
    await screen.findByText("x.txt");
    expect(document.querySelector("[data-current]")).toBeNull();
  });

  it("reveals a folder found among those joined, once closed", async () => {
    serveDisk();
    await finding("inner");
    await waitFor(() => expect(names()).toEqual(["deep", "inner"]));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(names()[0]).toBe("deep/inner"));
    expect(screen.getByText("deep/inner").closest("[data-current]")).not.toBeNull();
    expect(scrolled.mock.contexts.at(-1)).toHaveTextContent("deep/inner");
  });

  it("finds what git ignores too if asked, saying when nothing is found", async () => {
    const requests = serveDisk();
    await finding("");
    await userEvent.click(
      screen.getByRole("button", { name: "Include git-ignored files and folders" }),
    );
    await userEvent.type(field(), "nothing");
    expect(await screen.findByText("No files or folders found.")).toBeInTheDocument();
    const listed = requests
      .filter((request) => request.url.includes("/api/files/paths"))
      .map((request) => new URL(request.url).searchParams.get("ignored"));
    expect(listed).toEqual(["false", "true"]);
  });

  it("says when what is typed is an invalid expression, the tree as it was", async () => {
    serveDisk();
    await finding("");
    await userEvent.click(screen.getByRole("button", { name: "Use a regular expression" }));
    await userEvent.type(field(), "(");
    await waitFor(() => expect(status()).toHaveTextContent("Invalid regular expression"));
    expect(names()).toEqual(["deep", "proj", ".bashrc", "notes.md"]); // all, unfound
  });

  it("says when it may not list the Directory, as a problem", async () => {
    serveDisk({ refused: true });
    await finding("ma");
    const said = await screen.findByText("Could not find: not allowed to list /home/me");
    expect(said.className).toMatch(/problem/);
  });

  it("shows no rows of what it found before in the paths listed again", async () => {
    serveDisk();
    await finding("ma");
    await waitFor(() => expect(names()).toEqual(["proj", "main.py"]));
    await expectSettled();
    addToHome(entry("a.txt")); // listed before them all: the lines' numbers move
    const { seen, stop } = watchNames();
    onTestFinished(stop);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await expectSettled();
    stop();
    expect(seen.filter((rows) => rows.join() !== "proj,main.py")).toEqual([]);
  });

  it("says it is finding, rather than show the whole tree, until it found something", async () => {
    const answer = held();
    serveDisk({ wait: () => answer.promise });
    await finding("ma");
    expect(await screen.findByText("Finding…")).toBeInTheDocument();
    expect(screen.queryByText("notes.md")).toBeNull();
    answer.release();
    await waitFor(() => expect(names()).toEqual(["proj", "main.py"]));
  });

  it("keeps what it found while it lists the paths again, hidden ones or not", async () => {
    const answer = held();
    const requests = serveDisk({
      wait: (query) => (query.get("hidden") === "false" ? answer.promise : undefined),
    });
    await finding("ma");
    await waitFor(() => expect(names()).toEqual(["proj", "main.py"]));
    await userEvent.click(screen.getByRole("button", { name: "Hidden files" }));
    await waitFor(() =>
      expect(requests.some((request) => request.url.includes("hidden=false"))).toBe(true),
    );
    expect(names()).toEqual(["proj", "main.py"]); // not the whole tree, while it is asked for
    expect(status()).toHaveTextContent("1 of 1");
    answer.release();
    await expectSettled();
    expect(names()).toEqual(["proj", "main.py"]);
  });

  // 1,000 rows drawn: seconds in jsdom, more under the load of all tests.
  it("counts paths found, not matches, saying it shows the first 1,000", {
    timeout: 30_000,
  }, async () => {
    const many = Array.from({ length: 1_500 }, (_, at) => `f-${String(at).padStart(4, "0")}.txt`);
    addToHome(
      folder("many"),
      many.map((name) => entry(name)),
    );
    serveDisk({ paths: ["many/", ...many.map((name) => `many/${name}`)] });
    await finding("");
    await userEvent.click(screen.getByRole("button", { name: "Use a regular expression" }));
    await userEvent.type(field(), "."); // 10 matches in a name: 15,000 in all
    await waitFor(() => expect(status()).toHaveTextContent("1 of 1,000; first 1,000 shown"), {
      timeout: 20_000,
    });
    expect(status()?.getAttribute("title")).toMatch(/^1,501 found; the first 1,000 show/); // and many/
  });

  it.each([
    [{ stopped: "time", limit: 10 }, "stopped after 10 s"],
    [{ stopped: "max_paths", limit: 200_000 }, "stopped at 200,000 paths"],
  ] as const)("says why the paths listed may not be all: %o", async (stopped, said) => {
    serveDisk({ stopped });
    await finding("ma");
    await waitFor(() => expect(status()).toHaveTextContent(`1 of 1; ${said}`));
  });

  it("opens as its address says, and closing leaves what git ignores out again", async () => {
    const requests = serveDisk();
    await opened({ path: "/home/me" }, undefined, { find: ["ma"], regex: ["1"], ignored: ["1"] });
    await waitFor(() => expect(names()).toEqual(["proj", "main.py"]));
    expect(field()).toHaveValue("ma");
    expect(screen.getByRole("button", { name: "Use a regular expression" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const asked = requests.find((request) => request.url.includes("/api/files/paths"));
    expect(new URL(asked?.url ?? "/").searchParams.get("ignored")).toBe("true");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("search")).toBeNull());
    expect(document.querySelector("output")?.textContent).not.toMatch(/ignored|find|regex/);
  });
});

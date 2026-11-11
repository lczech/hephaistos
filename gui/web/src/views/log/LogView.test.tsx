import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOG_PAGE } from "../../api/queries";
import { cells, endOfList, listRows } from "../../test/list";
import { json, renderWithQueries, serve } from "../../test/server";
import { expectSettled, InPanel } from "../../test/view";
import type { Params } from "../address";
import { LogView } from "./LogView";
import type { LogEntry } from "./logText";

/** The nth record of the day, written by the Daemon's process 4242. */
function entry(n: number, record: Partial<LogEntry["record"]> = {}): LogEntry {
  return {
    position: `2026-10-14:${n * 100}`,
    record: {
      at: new Date(Date.UTC(2026, 9, 14, 16, 0, n)).toISOString(),
      level: "INFO",
      process: "daemon",
      pid: 4242,
      logger: "hephaistos.daemon.watcher.watcher",
      message: `pass ${n}`,
      ...record,
    },
  };
}

/** A Server with this log, its pages as `/api/log` answers them. */
function serveLog(pages: LogEntry[] | ((url: URL) => LogEntry[]), skipped = 0): Request[] {
  return serve({
    "GET /api/log": (request) =>
      json({
        entries: typeof pages === "function" ? pages(new URL(request.url)) : pages,
        skipped,
      }),
  });
}

const setTitle = vi.fn<(title: string) => void>();
beforeEach(() => setTitle.mockClear());

/** The View as a Panel holds it: with its parameters, here shown as its address. */
function Log({ at = {} }: { at?: Params }) {
  return <InPanel view={LogView} kind="log" params={at} onTitle={setTitle} />;
}

const address = () => screen.getByRole("status").textContent;
/** What the last request for the log asked for. */
const asked = (requests: Request[]) => new URL(requests.at(-1)?.url ?? "").searchParams;

/** The texts of a row's cells, after the level's square. */
const failed = entry(2, {
  level: "ERROR",
  pid: 77,
  process: "cli",
  message: "unexpected ModuleNotFoundError",
  error: "Traceback (most recent call last):\n  …\nModuleNotFoundError: No module named 'uvicorn'",
  trigger: "api",
});

describe("the Log View", () => {
  it("lists records newest first, as `log show` prints them, by level", async () => {
    serveLog([entry(3, { level: "WARNING", observed: 7 }), failed, entry(1, { level: "DEBUG" })]);
    renderWithQueries(<Log />);
    expect(await screen.findByText("pass 1")).toBeInTheDocument();
    await expectSettled();
    const rows = listRows();
    expect(rows.map(cells).map(([, ...others]) => others)).toEqual([
      ["daemon[4242]", "pass 3 observed=7"],
      [
        "cli[77]",
        "unexpected ModuleNotFoundError ↳ ModuleNotFoundError: No module named 'uvicorn' trigger=api",
      ],
      ["daemon[4242]", "pass 1"],
    ]);
    expect(cells(rows[0] as HTMLElement)[0]).toMatch(/^2026-10-14 \d\d:00:03\.000$/);
    expect(rows.map((row) => row.dataset.tone)).toEqual(["warning", "danger", "muted"]);
    expect(within(rows[1] as HTMLElement).getByTitle("error")).toBeInTheDocument();
    expect(setTitle).toHaveBeenLastCalledWith("Log");
  });

  it("opens a record's details with its traceback, and shows only its process", async () => {
    const requests = serveLog([entry(3), failed]);
    renderWithQueries(<Log at={{ level: "info" }} />);
    await userEvent.click(await screen.findByRole("button", { name: /unexpected/ }));
    const details = screen.getByRole("region", { name: "Record details" });
    expect(within(details).getByText("2026-10-14:200")).toBeInTheDocument();
    expect(within(details).getByText(/Traceback \(most recent call last\)/)).toBeInTheDocument();
    expect(within(details).getByText("api")).toBeInTheDocument();
    await userEvent.click(within(details).getByRole("button", { name: "Only this process" }));
    expect(address()).toBe("log?level=info&pid=77&process=cli");
    await vi.waitFor(() => expect(asked(requests).get("pid")).toBe("77"));
    expect(asked(requests).get("process")).toBe("cli");
    expect(setTitle).toHaveBeenLastCalledWith("Log: info+, cli[77]");
    expect(within(details).queryByRole("button", { name: "Only this process" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(address()).toBe("log");
  });

  it("loads older records on scrolling to the end, from the oldest shown", async () => {
    const scrolledToEnd = endOfList();
    const newest = Array.from({ length: LOG_PAGE }, (_, i) => entry(LOG_PAGE + 1 - i));
    const requests = serveLog((url) => (url.searchParams.has("before") ? [entry(1)] : newest));
    renderWithQueries(<Log />);
    expect(await screen.findByText("Older records load as you scroll.")).toBeInTheDocument();
    act(() => scrolledToEnd());
    expect(await screen.findByText("pass 1")).toBeInTheDocument();
    // The last request for older ones: a refetch may come after it.
    const older = requests.filter((request) => request.url.includes("before="));
    expect(asked(older).get("before")).toBe("2026-10-14:200");
    expect(asked(older).get("limit")).toBe(String(LOG_PAGE));
  });

  it("says nothing of other filters while those of the ones asked for load", async () => {
    serve({
      "GET /api/log": (request) =>
        new URL(request.url).searchParams.has("since")
          ? json({ entries: [], skipped: 0 })
          : new Promise<never>(() => {}), // without filters: still loading
    });
    renderWithQueries(<Log at={{ since: "1h" }} />);
    expect(await screen.findByText("No records match.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(address()).toBe("log");
    expect(screen.getByText("Loading the log…")).toBeInTheDocument(); // not "No records yet."
  });

  it("says when there are none, and when lines were not records", async () => {
    serveLog([]);
    const { unmount } = renderWithQueries(<Log at={{ since: "1h" }} />);
    expect(await screen.findByText("No records match.")).toBeInTheDocument();
    unmount();
    serveLog([entry(1)], 2);
    renderWithQueries(<Log />);
    expect(
      await screen.findByText("Some lines in the log files are not records."),
    ).toBeInTheDocument();
  });
});

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { exactRequests } from "../../test/fuzz";
import { saveViews } from "../../test/layout";
import { lastSocket } from "../../test/live";
import { daemon, info, json, renderWithQueries, serve, status } from "../../test/server";
import { takeTokenFromUrl } from "../../token";

const PROBLEM = {
  name: "linger",
  outcome: "problem" as const,
  text: "off: the daemon starts at login, and stops at logout",
  fix: "`hephaistos daemon install --linger` runs it from boot, also when logged out",
};
const NOTE = { name: "ionice", outcome: "note" as const, text: "not installed", fix: null };
const PATHS = {
  name: "unit",
  outcome: "problem" as const,
  text: "it uses other directories than this shell (HEPHAISTOS_HOME: not set in the unit, /home/me/h in this shell)",
  fix: "`hephaistos daemon install`",
};

function routes(checks = [PROBLEM, NOTE], counts = { warnings: 3, errors: 1 }) {
  const answer = status(checks);
  const recorded = daemon();
  recorded.checks = { checked_at: answer.log.since, checks: answer.checks };
  return {
    "GET /api/info": () => json(info()),
    "GET /api/config": () => json({ settings: [] }),
    "GET /api/daemon": () => json(recorded),
    "GET /api/status": () => json({ ...answer, log: { ...answer.log, ...counts } }),
    "GET /api/log": () => json({ entries: [], skipped: 0 }),
    "POST /api/observe": () => new Response(null, { status: 204 }),
  };
}

function open(): void {
  window.history.replaceState(null, "", "/#token=secret");
  takeTokenFromUrl();
  saveViews("status");
}

describe("the Status View", () => {
  it("lists the checks, with what to do; Refresh checks again and asks for a pass", async () => {
    exactRequests(); // counts what it asks
    open();
    const requests = serve(routes());
    renderWithQueries(<App />);
    const linger = (await screen.findByText("linger")).closest("li");
    expect(linger).toHaveAttribute("data-outcome", "problem");
    expect(
      within(linger as HTMLElement).getByText("hephaistos daemon install --linger"),
    ).toHaveProperty("tagName", "CODE");
    expect(screen.getByText("ionice").closest("li")).toHaveAttribute("data-outcome", "note");
    expect(screen.getByText("gui").closest("li")).toHaveTextContent(/built for API/);
    const asked = (path: string) => requests.filter((r) => new URL(r.url).pathname === path).length;
    expect(asked("/api/status")).toBe(1);
    const passes = asked("/api/observe"); // one as the GUI opens
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(asked("/api/status")).toBe(2));
    expect(asked("/api/observe")).toBe(passes + 1);
  });

  it("shows a problem in the icon of its tab and in that of the status bar", async () => {
    open();
    serve(routes());
    renderWithQueries(<App />);
    await waitFor(() => lastSocket());
    act(() => lastSocket().open());
    const health = await screen.findByRole("button", { name: /^Status: linger: off/ });
    expect(health).toHaveAttribute("data-health", "warning");
    expect(health.querySelector("svg")).toHaveClass("lucide-circle-alert");
    const tab = screen.getByTitle("status"); // as the saved Layout names it
    expect(tab.querySelector("svg")).toHaveClass("lucide-circle-alert");
  });

  it("links to the recent warnings and errors in the log", async () => {
    open();
    const requests = serve(routes());
    renderWithQueries(<App />);
    const link = await screen.findByRole("button", {
      name: "The log: warnings and errors of the last day",
    });
    expect(link).toHaveTextContent(/^Log$/);
    expect(link.parentElement?.nextElementSibling).toHaveTextContent(
      /^1 error and 3 warnings in the last day$/,
    ); // its value
    expect(screen.queryByRole("button", { name: "The settings" })).not.toBeInTheDocument();
    await userEvent.click(link);
    await waitFor(() => {
      const log = requests.find((r) => new URL(r.url).pathname === "/api/log");
      expect(new URL(log?.url ?? "http://x").searchParams.get("level")).toBe("warning");
    });
  });

  it("names only what the log has, else links to all of it", async () => {
    open();
    serve(routes([], { warnings: 2, errors: 0 }));
    const { unmount } = renderWithQueries(<App />);
    const some = await screen.findByRole("button", {
      name: "The log: warnings and errors of the last day",
    });
    expect(some).toHaveTextContent(/^Log$/);
    expect(some.parentElement?.nextElementSibling).toHaveTextContent(
      /^2 warnings in the last day$/,
    ); // its value
    unmount();
    serve(routes([], { warnings: 0, errors: 0 }));
    renderWithQueries(<App />);
    const link = await screen.findByRole("button", { name: "The log" });
    expect(link).toHaveTextContent(/^Log$/);
    expect(link.parentElement?.nextElementSibling).toHaveTextContent(
      /^No errors or warnings in the last day$/,
    ); // its value
  });

  it("copies Setup, every check, and About as Markdown", async () => {
    open();
    serve(routes([PROBLEM, NOTE, PATHS]));
    const writeText = vi.fn(async (_: string) => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderWithQueries(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Copy Setup and About" }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    const text = writeText.mock.calls[0]?.[0] ?? "";
    expect(text).toMatch(
      /^\*\*hephaistos status\*\*\n\nSetup:\n- git \(ok\): 2\.43\.0, \/usr\/bin\/git\n/,
    );
    expect(text.indexOf("\nAbout:\n")).toBeGreaterThan(text.indexOf("- ionice (note)"));
    expect(text).toContain("- hephaistos: 0.1.0 (abc1234)\n");
    expect(text).toContain("- Daemon: running under systemd, pid 4242, since ");
    expect(text).not.toContain("not under systemd");
    expect(text).toContain("- Time zone: Europe/Berlin\n");
    expect(text).toContain(`- linger (problem): ${PROBLEM.text}\n`);
    expect(text).toContain("- ionice (note): not installed\n");
    expect(text).not.toContain("laptop"); // the name of the Machine
    expect(text).toContain(
      "- unit (problem): it uses other directories than this shell (HEPHAISTOS_HOME: not set in the unit, ~/h in this shell)\n",
    );
    expect(text).not.toContain("/home/");
  });

  it("lists the paths, each copied in full, and none in Setup and About", async () => {
    open();
    serve(routes());
    const writeText = vi.fn(async (_: string) => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderWithQueries(<App />);
    const copy = await screen.findByRole("button", { name: "Copy the path of Data" });
    const path = copy.parentElement as HTMLElement;
    // Under ~ once /api/info gives the home directory, which may answer after /api/status.
    await waitFor(() =>
      expect(path).toHaveTextContent(/^~\/\.local\/share\/hephaistos\/d1c604c9$/),
    );
    expect(path.lastElementChild).toBe(copy); // after it
    const holds = path.nextElementSibling as HTMLElement; // on the line below
    expect(holds).toHaveTextContent(/^1\.1 MB, the database and the server token/);
    expect(path.parentElement?.previousElementSibling).toHaveTextContent(/^Data$/); // its label
    await userEvent.click(copy);
    expect(writeText).toHaveBeenLastCalledWith("/home/me/.local/share/hephaistos/d1c604c9");
    expect(within(holds).getByRole("status")).toHaveTextContent("Copied");
    await userEvent.click(screen.getByRole("button", { name: "Copy Setup and About" }));
    expect(writeText.mock.lastCall?.[0]).not.toContain(".local");
  });

  it("says what is missing from a daemon without paths, before API 0.26", async () => {
    open();
    const answer = status();
    // @ts-expect-error: before API 0.26, the status had no paths
    delete answer.paths;
    serve({ ...routes(), "GET /api/status": () => json(answer) });
    renderWithQueries(<App />);
    expect(await screen.findByText("Not loaded; see Setup")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Setup and About" })).toBeInTheDocument();
  });

  it("says why a copy failed, each message for its own moment", async () => {
    open();
    serve(routes());
    const writeText = vi.fn(async (_: string) => {
      throw new Error("denied");
    });
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderWithQueries(<App />);
    const copy = await screen.findByRole("button", { name: "Copy Setup and About" });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await userEvent.click(copy);
      expect(await screen.findByText("Not copied: denied")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(2_000));
      await userEvent.click(copy);
      act(() => vi.advanceTimersByTime(2_000)); // the first would end now
      expect(screen.getByText("Not copied: denied")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1_500));
      expect(screen.queryByText("Not copied: denied")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a daemon of an older API, which names no problems of a pass", async () => {
    open();
    const answer = routes();
    const older = daemon();
    // @ts-expect-error: before API 0.25, a pass had no problems
    delete older.watcher?.last_pass?.problems;
    serve({ ...answer, "GET /api/daemon": () => json(older) });
    renderWithQueries(<App />);
    expect(await screen.findByText(/by the watcher$/)).toBeInTheDocument();
  });

  it("says what is missing from a daemon without /api/status, before API 0.23", async () => {
    open();
    serve({ ...routes(), "GET /api/status": () => new Response(null, { status: 404 }) });
    renderWithQueries(<App />);
    expect(await screen.findAllByText("Not loaded; see Setup")).toHaveLength(3);
    expect(await screen.findByText(/^running, pid 4242/)).toBeInTheDocument(); // /api/daemon
  });

  it("shows Running from one answer only", async () => {
    open();
    const { "GET /api/daemon": _, ...others } = routes();
    serve({ ...others, "GET /api/daemon": () => new Response(null, { status: 500 }) });
    renderWithQueries(<App />);
    // From the setup, as /api/daemon failed: its Watcher and Server too, not "not running".
    expect(await screen.findByText(/^running, pid 4242/)).toBeInTheDocument();
    expect(screen.queryByText("not running")).not.toBeInTheDocument();
  });

  it("checks again only while shown", async () => {
    exactRequests(); // counts what it asks
    open();
    saveViews("status", "log");
    const requests = serve(routes());
    const { client } = renderWithQueries(<App />);
    await screen.findByText("linger");
    const asked = () => requests.filter((r) => new URL(r.url).pathname === "/api/status").length;
    expect(asked()).toBe(1);
    await userEvent.click(screen.getByTitle("log"));
    const log = () => requests.some((r) => new URL(r.url).pathname === "/api/log");
    await waitFor(() => expect(log()).toBe(true)); // the Log View shows
    await act(() => client.invalidateQueries()); // as on a reconnect
    expect(asked()).toBe(1);
    await userEvent.click(screen.getByTitle("status"));
    await waitFor(() => expect(asked()).toBe(2));
  });
});

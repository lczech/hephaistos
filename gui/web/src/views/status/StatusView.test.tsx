import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { saveViews } from "../../test/layout";
import { lastSocket } from "../../test/live";
import { daemon, info, json, renderWithQueries, serve, status } from "../../test/server";
import { takeTokenFromUrl } from "../../token";

const PROBLEM = {
  name: "linger",
  outcome: "problem" as const,
  text: "off: the daemon starts at login, and stops at logout",
  fix: "`hephaistos daemon install --linger`",
};
const NOTE = { name: "ionice", outcome: "note" as const, text: "not installed", fix: null };
const PATHS = {
  name: "unit",
  outcome: "problem" as const,
  text: "it keeps its data elsewhere: HEPHAISTOS_HOME: the unit has none, here /home/me/h",
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

  it("shows a problem in its tab's icon and the status bar's", async () => {
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

  it("links to the log's recent warnings and errors", async () => {
    open();
    const requests = serve(routes());
    renderWithQueries(<App />);
    const link = await screen.findByRole("button", {
      name: "The log's warnings and errors of the last day",
    });
    expect(link).toHaveTextContent("1 error and 3 warnings");
    expect(link.parentElement).toHaveTextContent(/^1 error and 3 warnings in the last day$/);
    expect(screen.queryByRole("button", { name: "The settings" })).not.toBeInTheDocument();
    await userEvent.click(link);
    await waitFor(() => {
      const log = requests.find((r) => new URL(r.url).pathname === "/api/log");
      expect(new URL(log?.url ?? "http://x").searchParams.get("level")).toBe("warning");
    });
  });

  it("says when the log has nothing to look at", async () => {
    open();
    serve(routes([], { warnings: 0, errors: 0 }));
    renderWithQueries(<App />);
    expect(await screen.findByText("No errors or warnings in the last day")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "The log" })).toHaveTextContent("Log");
  });

  it("copies About for an issue, with the setup's problems and notes", async () => {
    open();
    serve(routes([PROBLEM, NOTE, PATHS]));
    const writeText = vi.fn(async (_: string) => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderWithQueries(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Copy for an issue" }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    const text = writeText.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("- hephaistos: 0.1.0 (abc1234)\n");
    expect(text).toContain("- Daemon: running under systemd, pid 4242, since ");
    expect(text).toContain("- Time zone: Europe/Berlin\n");
    expect(text).toContain(`- linger (problem): ${PROBLEM.text}\n`);
    expect(text).toContain("- ionice (note): not installed\n");
    expect(text).not.toContain("laptop"); // the Machine's name
    expect(text).toContain(
      "- unit (problem): it keeps its data elsewhere: HEPHAISTOS_HOME: the unit has none, here ~/h\n",
    );
    expect(text).not.toContain("/home/");
  });
});

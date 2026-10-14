import { describe, expect, it } from "vitest";
import { logChoices, logColumnFilters, logFilters, logParams, logTitle } from "./choices";

describe("the Log filters", () => {
  it("are asked of the Server as its parameters", () => {
    expect(logFilters({ level: "warning", process: "daemon", pid: "4242", since: "1d" })).toEqual({
      level: "warning",
      process: "daemon",
      pid: 4242,
      since: "1d",
    });
    expect(logFilters({})).toEqual({});
  });

  it("show one process, its kind and pid, in the process column", () => {
    const params = { process: "daemon", pid: "4242", since: "1h" };
    const filters = logColumnFilters(params);
    expect(filters).toEqual([
      { id: "time", value: ["1h"] },
      { id: "process", value: ["daemon[4242]"] },
    ]);
    expect(logParams(params, filters)).toEqual(params);
    expect(logColumnFilters({ pid: "4242" })).toEqual([{ id: "process", value: ["?[4242]"] }]);
    expect(logParams({ pid: "4242" }, logColumnFilters({ pid: "4242" }))).toEqual({ pid: "4242" });
  });

  it("drop the pid on choosing another process, or none", () => {
    const params = { process: "daemon", pid: "4242" };
    expect(logParams(params, [{ id: "process", value: ["cli"] }])).toEqual({ process: "cli" });
    expect(logParams(params, [])).toEqual({});
  });

  it("offer the process chosen, and name it in the title", () => {
    const params = { level: "warning", process: "daemon", pid: "4242" };
    const choices = logChoices(params);
    expect(choices.process?.map(({ label }) => label)).toEqual(["cli", "daemon", "daemon[4242]"]);
    expect(logTitle(logColumnFilters(params), choices)).toBe("Log: warning+, daemon[4242]");
    expect(logTitle([], logChoices({}))).toBe("Log");
  });
});

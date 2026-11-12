import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { linesOf, listRows } from "../../test/list";
import { json, renderWithQueries, serve } from "../../test/server";
import { expectSettled, InPanel } from "../../test/view";
import { LogView } from "./LogView";

// How the Log View lays out its rows, as a browser draws it: its styles select the List's rows,
// which only a browser applies.

describe("the Log View, drawn", () => {
  it("in two lines, puts the message first, when and by which process below it", async () => {
    localStorage.setItem("hephaistos.lists.log.layout", '"lines"');
    const record = {
      at: new Date().toISOString(),
      level: "INFO",
      process: "daemon",
      pid: 4242,
      logger: "hephaistos.daemon",
      message: "pass 1",
    };
    serve({ "GET /api/log": () => json({ entries: [{ position: "p:1", record }], skipped: 0 }) });
    renderWithQueries(
      <div style={{ width: 700 }}>
        <InPanel view={LogView} kind="log" />
      </div>,
    );
    await screen.findByText("pass 1");
    await expectSettled();
    const [row] = listRows();
    expect(linesOf(row as HTMLElement)).toEqual([
      ["level", "message"],
      ["time", "process"],
    ]);
  });
});

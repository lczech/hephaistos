import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { noticeAtom } from "../notice";
import { daemon, info, json, renderWithQueries, serve } from "../test/server";
import { StatusBar } from "./StatusBar";

describe("the status bar", () => {
  it("says a notice in a region there all along, so that screen readers say it", async () => {
    serve({
      "GET /api/info": () => json(info()),
      "GET /api/daemon": () => json(daemon()),
    });
    renderWithQueries(<StatusBar />);
    await screen.findByText(/hephaistos 0\.1\.0/);
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    act(() => noticeAtom.set("Copied notes.md"));
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Copied notes.md");
    expect(screen.queryByText(/hephaistos 0\.1\.0/)).toBeNull(); // in its place for a while
    act(() => noticeAtom.set(null));
    await waitFor(() => expect(region).toBeEmptyDOMElement());
    expect(screen.getByRole("status")).toBe(region);
  });
});

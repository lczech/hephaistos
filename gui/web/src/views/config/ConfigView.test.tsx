import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { info, json, renderWithQueries, serve } from "../../test/server";
import { ConfigView } from "./ConfigView";

const CONFIG = "/home/me/.config/hephaistos/config.toml";

describe("the Config View", () => {
  it("shows each setting, where it comes from and what it does", async () => {
    serve({
      "GET /api/info": () => json(info()),
      "GET /api/config": () =>
        json({
          host: "laptop",
          settings: [
            {
              key: "git.timeout",
              description: "Seconds one git command may take.",
              type: "float",
              value: 90,
              source: CONFIG,
              applied: 30,
            },
            {
              key: "scan.depth",
              description: "Directory levels searched by `scan`.",
              type: "int",
              value: 3,
              source: "default",
              applied: 3,
            },
          ],
          sources: [{ source: CONFIG, kind: "file", state: "read", error: null }],
          other_hosts: [],
          unknown_variables: [],
        }),
    });
    renderWithQueries(<ConfigView />);
    expect(await screen.findByText("git.timeout")).toBeInTheDocument();
    expect(screen.getByText("config.toml")).toHaveAttribute("title", CONFIG);
    expect(
      screen.getByText("The Daemon uses 30.0 until it restarts. Seconds one git command may take.")
        .parentElement,
    ).toHaveAttribute("data-tone", "warning");
    expect(screen.getByText("3")).toHaveAttribute("data-preset");
    expect(screen.getByText("scan", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText("Host: laptop")).toBeInTheDocument();
    expect(await screen.findByText("~/.config/hephaistos/config.toml")).toBeInTheDocument();
  });

  it("says when the Daemon doesn't answer", async () => {
    serve({ "GET /api/config": () => json({ error: "gone" }, 500) });
    renderWithQueries(<ConfigView />);
    expect(await screen.findByText("Couldn't load: gone")).toBeInTheDocument();
  });
});

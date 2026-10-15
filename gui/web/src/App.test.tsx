import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { Boundary } from "./components/Boundary";
import { saveViews } from "./test/layout";
import { daemon, info, json, renderWithQueries, serve } from "./test/server";
import { takeTokenFromUrl, token } from "./token";
import { builtFor } from "./version";

function signIn(): void {
  window.history.replaceState(null, "", "/#token=secret");
  takeTokenFromUrl();
}

const ok = {
  "GET /api/info": () => json(info()),
  "GET /api/daemon": () => json(daemon()),
  "GET /api/repositories": () => json([]),
  "POST /api/observe": () => new Response(null, { status: 204 }),
};

describe("the GUI", () => {
  it("asks for the token without one", () => {
    const requests = serve(ok);
    renderWithQueries(<App />);
    expect(screen.getByText("hephaistos daemon token --url")).toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it("shows the Daemon and this Machine, asking for a pass as it opens", async () => {
    signIn();
    saveViews("daemon");
    const requests = serve(ok);
    renderWithQueries(<App />);
    expect(await screen.findByText(/^running, pid 4242/)).toBeInTheDocument();
    expect(screen.getByText(/^every 60 s; next pass in/)).toBeInTheDocument();
    const { major, minor } = builtFor();
    expect(
      screen.getByText(`laptop · hephaistos 0.1.0 (abc1234) · API ${major}.${minor}`),
    ).toBeInTheDocument();
    expect(screen.getByText("updated now")).toBeInTheDocument();
    const observe = requests.find((request) => request.method === "POST");
    expect(observe?.headers.get("Authorization")).toBe("Bearer secret");
  });

  it("forgets a token the Server refuses", async () => {
    signIn();
    serve({ "GET /api/info": () => json({ error: "wrong token" }, 401) });
    renderWithQueries(<App />);
    expect(await screen.findByText("hephaistos daemon token --url")).toBeInTheDocument();
    expect(token()).toBeNull();
  });

  it("says when the Server doesn't answer", async () => {
    signIn();
    serve({
      "GET /api/info": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    renderWithQueries(<App />);
    expect(await screen.findByText("no answer: Failed to fetch")).toBeInTheDocument();
  });

  it("passes when asked, and shows why one failed", async () => {
    signIn();
    saveViews("daemon");
    let passes = 0;
    serve({
      ...ok,
      "POST /api/observe": () => {
        passes += 1;
        return passes === 1
          ? new Response(null, { status: 204 })
          : json({ error: "the pass failed: git is gone" }, 503);
      },
    });
    renderWithQueries(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Observe now" }));
    expect(await screen.findByText("the pass failed: git is gone")).toBeInTheDocument();
    expect(passes).toBe(2);
  });

  it("names the restart for a Daemon of an older version", async () => {
    signIn();
    saveViews("daemon");
    serve({ ...ok, "GET /api/info": () => json(info({ major: 0, minor: 0 })) });
    renderWithQueries(<App />);
    expect(await screen.findByText(/restart it: `hephaistos daemon restart`/)).toBeInTheDocument();
    expect(await screen.findByText(/^running, pid 4242/)).toBeInTheDocument();
  });

  it("shows nothing but the hint for another major", async () => {
    signIn();
    serve({ ...ok, "GET /api/info": () => json(info({ major: 9, minor: 0 })) });
    renderWithQueries(<App />);
    expect(await screen.findByText(/rebuild the GUI/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Daemon")).not.toBeInTheDocument());
  });
});

describe("a part that fails", () => {
  function Broken(): never {
    throw new Error("no such field");
  }

  it("shows its error", () => {
    const quiet = console.error;
    console.error = () => {}; // React reports the error it caught
    try {
      renderWithQueries(
        <Boundary>
          <Broken />
        </Boundary>,
      );
    } finally {
      console.error = quiet;
    }
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't show this: no such field");
  });
});

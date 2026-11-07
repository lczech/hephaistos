import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TitleBar } from "../components/TitleBar";
import { saveGrid } from "../test/layout";
import { daemon, json, renderWithQueries, serve } from "../test/server";
import { savedLayout } from "./saved";
import { ViewOpener } from "./ViewOpener";
import { Workbench } from "./Workbench";

/** A frame passing: dockview shows Views over their Groups at the next. */
const nextFrame = () => act(() => new Promise<void>((done) => requestAnimationFrame(() => done())));

async function renderShell() {
  const rendered = renderWithQueries(
    <ViewOpener>
      <TitleBar />
      <Workbench />
    </ViewOpener>,
  );
  await nextFrame();
  return rendered;
}

/** The tabs by Group, in reading order; previews marked `*`, the tab each shows in brackets. */
const groups = () =>
  [...document.querySelectorAll(".dv-groupview")].map((group) =>
    [...group.querySelectorAll("[role=tab]")].map((tab) => {
      const name = `${tab.getAttribute("aria-label")}${tab.querySelector("[class*=preview]") ? "*" : ""}`;
      return tab.closest(".dv-tab")?.classList.contains("dv-active-tab") ? `[${name}]` : name;
    }),
  );

/** The tab shown in the Group that has the focus. */
const focused = () =>
  [...document.querySelectorAll(".dv-active-group [role=tab]")]
    .find((tab) => tab.closest(".dv-tab")?.classList.contains("dv-active-tab"))
    ?.getAttribute("aria-label");

const pressed = () =>
  screen
    .getAllByRole("button", { pressed: true })
    .map((button) => button.getAttribute("aria-label"));

const press = (label: string) => userEvent.click(screen.getByRole("button", { name: label }));

/** The saved Layout's Groups: their IDs in reading order, and the top's orientation. */
const savedGroups = () => {
  const grid = savedLayout()?.grid;
  const ids = (node: { data: unknown }): string[] =>
    Array.isArray(node.data) ? node.data.flatMap(ids) : [(node.data as { id: string }).id];
  return grid && { ids: ids(grid.root), orientation: grid.orientation };
};

beforeEach(() => {
  const page = { x: 0, y: 0, left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 };
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    ...page,
    toJSON: () => page,
  });
  serve({ "GET /api/daemon": () => json(daemon()) });
});

describe("the column buttons", () => {
  it("deal the tabs among that many Groups, and back again, none a preview", async () => {
    saveGrid([{ tabs: ["a", "b", "c*"] }, { tabs: ["d", "e"] }], "HORIZONTAL");
    await renderShell();
    expect(pressed()).toEqual(["2 columns"]);
    await press("3 columns");
    expect(groups()).toEqual([["[a]", "b"], ["c", "[d]"], ["[e]"]]); // d was shown
    expect(pressed()).toEqual(["3 columns"]);
    await press("4 columns");
    expect(groups()).toEqual([["[a]", "b"], ["[c]"], ["[d]"], ["[e]"]]);
    await press("2 columns");
    expect(groups()).toEqual([
      ["[a]", "b", "c"],
      ["[d]", "e"],
    ]);
    await press("One column");
    expect(groups()).toEqual([["[a]", "b", "c", "d", "e"]]);
    expect(pressed()).toEqual(["One column"]);
  });

  it("keep the tabs shown and the focus, and reuse each run's first tab's Group", async () => {
    saveGrid([{ tabs: ["a", "b"] }, { tabs: ["c", "d"] }], "HORIZONTAL");
    await renderShell();
    await userEvent.click(screen.getByRole("tab", { name: "b" }));
    await userEvent.click(screen.getByRole("tab", { name: "d" }));
    await press("One column");
    expect(groups()).toEqual([["a", "b", "c", "[d]"]]);
    expect(focused()).toBe("d");
    await press("3 columns");
    expect(groups()).toEqual([["[a]", "b"], ["[c]"], ["[d]"]]);
    expect(focused()).toBe("d");
    await waitFor(() => expect(savedGroups()?.ids[0]).toBe("1"));
  });

  it("make columns of rows and of splits within them, side by side at the top", async () => {
    // A wide Group on top of three side by side.
    saveGrid([{ tabs: ["a"] }, [{ tabs: ["b"] }, { tabs: ["c"] }, { tabs: ["d"] }]], "VERTICAL");
    await renderShell();
    expect(pressed()).toEqual(["One column"]);
    await press("4 columns");
    expect(groups()).toEqual([["[a]"], ["[b]"], ["[c]"], ["[d]"]]);
    expect(pressed()).toEqual(["4 columns"]);
    await waitFor(() => expect(savedGroups()?.orientation).toBe("HORIZONTAL"));
    await press("2 columns");
    expect(groups()).toEqual([
      ["[a]", "b"],
      ["[c]", "d"],
    ]);
  });

  it("make empty Groups where there are fewer tabs than columns", async () => {
    saveGrid([{ tabs: ["a"] }], "HORIZONTAL");
    await renderShell();
    await press("4 columns");
    expect(groups()).toEqual([["[a]"], [], [], []]);
    expect(screen.getAllByText("Open a view:")).toHaveLength(3);
    await press("2 columns");
    expect(groups()).toEqual([["[a]"], []]);
  });

  it("keep rows within the columns when pressed for as many as there are", async () => {
    saveGrid([[{ tabs: ["a"] }, { tabs: ["b"] }], { tabs: ["c"] }], "HORIZONTAL");
    await renderShell();
    expect(pressed()).toEqual(["2 columns"]);
    await press("2 columns");
    expect(groups()).toEqual([["[a]"], ["[b]"], ["[c]"]]);
    expect(pressed()).toEqual(["2 columns"]);
  });
});

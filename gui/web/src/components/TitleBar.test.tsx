import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { Address } from "../views/address";
import { OpenViewContext } from "../views/opening";
import { TitleBar } from "./TitleBar";

/** The Window Controls Overlay as the Desktop's Chromium has it, visible or not. */
function stubOverlay(visible: boolean) {
  const overlay = Object.assign(new EventTarget(), { visible });
  Object.defineProperty(navigator, "windowControlsOverlay", { value: overlay, configurable: true });
  return overlay;
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "windowControlsOverlay");
});

describe("the title bar", () => {
  it("leaves room for the window's buttons while they are over it, as in the Desktop", () => {
    const overlay = stubOverlay(false);
    render(<TitleBar />);
    const bar = screen.getByRole("banner");
    expect(bar).not.toHaveAttribute("data-window-buttons");
    act(() => {
      overlay.visible = true;
      overlay.dispatchEvent(new Event("geometrychange"));
    });
    expect(bar).toHaveAttribute("data-window-buttons");
  });

  it("offers every View that stands alone by family, opening it where Views open", async () => {
    const opened: Address[] = [];
    render(
      <OpenViewContext value={(address) => opened.push(address)}>
        <TitleBar />
      </OpenViewContext>,
    );
    expect(screen.getByRole("banner")).toBeInTheDocument(); // in a browser too
    await userEvent.click(screen.getByRole("button", { name: "View" }));
    const menu = screen.getByRole("menu");
    const families = within(menu)
      .getAllByRole("group")
      .map((family) => [
        family.getAttribute("aria-label"),
        within(family)
          .getAllByRole("menuitem")
          .map((item) => item.textContent),
      ]);
    expect(families).toEqual([
      ["overviews", ["Repositories", "Events"]],
      ["files", ["Explorer"]],
      ["this machine", ["Daemon", "Log", "Config", "Database"]],
    ]);
    expect(within(menu).getAllByRole("separator")).toHaveLength(2);
    await userEvent.click(screen.getByRole("menuitem", { name: "Config" }));
    expect(opened).toEqual([{ kind: "config", params: {} }]);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

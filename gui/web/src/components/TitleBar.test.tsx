import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
  it("isn't drawn in a browser, which has its own", () => {
    render(<TitleBar />);
    expect(screen.queryByRole("banner")).toBeNull();
  });

  it("is drawn while the window's buttons are over the page", () => {
    const overlay = stubOverlay(false);
    render(<TitleBar />);
    expect(screen.queryByRole("banner")).toBeNull();
    act(() => {
      overlay.visible = true;
      overlay.dispatchEvent(new Event("geometrychange"));
    });
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });
});

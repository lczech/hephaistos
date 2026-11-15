import { render, screen } from "@testing-library/react";
import { siGithub } from "simple-icons";
import { describe, expect, it } from "vitest";
import { ForgeLink } from "./ForgeLink";

const PAGE = { url: "https://github.com/me/proj", forge: "GitHub", icon: siGithub };

describe("a link to a forge", () => {
  it("opens in a new tab, telling the page nothing, named by its URL and forge", () => {
    render(<ForgeLink page={PAGE} />);
    const link = screen.getByRole("link", { name: "https://github.com/me/proj on GitHub" });
    expect(link).toHaveAttribute("href", PAGE.url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

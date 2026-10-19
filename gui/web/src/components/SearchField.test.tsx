import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SearchField } from "./SearchField";

function Held({ onSubmit }: { onSubmit: () => void }) {
  const [value, setValue] = useState("row");
  return (
    <>
      <output>{value}</output>
      <SearchField label="Search" value={value} onChange={setValue} onSubmit={onSubmit} />
    </>
  );
}

describe("the search field", () => {
  it("changes what is searched for with each key, searches on Enter, clears on Escape", async () => {
    const submitted = vi.fn();
    render(<Held onSubmit={submitted} />);
    const field = screen.getByRole("searchbox", { name: "Search" });
    await userEvent.type(field, " view");
    expect(screen.getByRole("status")).toHaveTextContent("row view");
    await userEvent.type(field, "{Enter}");
    expect(submitted).toHaveBeenCalledOnce();
    await userEvent.type(field, "{Escape}");
    expect(field).toHaveValue("");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

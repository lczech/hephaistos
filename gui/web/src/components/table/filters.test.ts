import { describe, expect, it } from "vitest";
import { type Choice, filterText, toggled } from "./filters";

const added = { value: "clone.registered", label: "clone.registered" };
const moved = { value: "clone.moved", label: "clone.moved" };
const clone: Choice = { value: "clone", label: "clone", choices: [added, moved] };
const machine: Choice = { value: "machine", label: "machine" };

describe("ticking a choice", () => {
  it("adds it, or takes it away again", () => {
    expect(toggled([], machine)).toEqual(["machine"]);
    expect(toggled(["clone.registered", "machine"], machine)).toEqual(["clone.registered"]);
  });

  it("covers the choices within it, so they needn't be chosen too", () => {
    expect(toggled(["clone.registered", "machine"], clone)).toEqual(["machine", "clone"]);
  });

  it("leaves the others within one chosen as a whole", () => {
    expect(toggled(["machine", "clone"], added, clone)).toEqual(["machine", "clone.moved"]);
    expect(toggled(["machine"], added, clone)).toEqual(["machine", "clone.registered"]);
  });
});

describe("what a filter is set to", () => {
  it("is the one chosen, by its label, also within another", () => {
    expect(filterText(["clone"], [clone, machine])).toBe("clone");
    expect(filterText(["0199"], [{ value: "0199", label: "project" }])).toBe("project");
    expect(filterText(["clone.moved"], [clone])).toBe("clone.moved");
    expect(filterText(["3d"], [])).toBe("3d"); // not one of the choices: as it is
  });

  it("is how many, of several", () => {
    expect(filterText(["clone", "machine"], [clone, machine], "kinds")).toBe("2 kinds");
  });
});

import { describe, expect, it } from "vitest";
import { directoriesBelow } from "./paths";

describe("directories below a path", () => {
  const paths = ["README.md", "src/a/x.py", "src/a/y.py", "src/b.py", "notes/guide/z.md", "new/"];
  const below = (base: string, nested: boolean, of = paths) =>
    directoriesBelow(of, (path) => path, base, nested);

  it("show each by its path, flat", () => {
    expect(below("", false)).toEqual({
      directories: [
        { path: "src/a/", items: ["src/a/x.py", "src/a/y.py"] },
        { path: "src/", items: ["src/b.py"] },
        { path: "notes/guide/", items: ["notes/guide/z.md"] },
      ],
      direct: ["README.md", "new/"],
    });
  });

  it("show those directly below, nested, one holding a single directory joined with it", () => {
    expect(below("", true)).toEqual({
      directories: [
        { path: "src/", items: ["src/a/x.py", "src/a/y.py", "src/b.py"] },
        { path: "notes/guide/", items: ["notes/guide/z.md"] },
      ],
      direct: ["README.md", "new/"],
    });
    expect(below("src/", true, ["src/a/x.py", "src/a/y.py", "src/b.py"])).toEqual({
      directories: [{ path: "src/a/", items: ["src/a/x.py", "src/a/y.py"] }],
      direct: ["src/b.py"],
    });
  });
});

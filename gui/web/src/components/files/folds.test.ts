import { describe, expect, it } from "vitest";
import { foldedBy, unfolding, withFolded } from "./folds";

describe("folds", () => {
  const paths = new Set(["bench/", "src/app/", "src/main.py"]);

  it("fold a path by itself or the outermost directory above it", () => {
    expect(foldedBy(paths, "src/main.py")).toBe("src/main.py");
    expect(foldedBy(paths, "src/app/")).toBe("src/app/");
    expect(foldedBy(paths, "bench/x/")).toBe("bench/"); // a chain joined, or by its path
    expect(foldedBy(paths, "bench/x/run.py")).toBe("bench/");
    expect(foldedBy(new Set(["a/", "a/b/"]), "a/b/c.py")).toBe("a/");
    expect(foldedBy(paths, "src/")).toBeUndefined(); // only below it is folded
    expect(foldedBy(paths, "src/other.py")).toBeUndefined();
    expect(foldedBy(paths, "benchmarks/")).toBeUndefined(); // by whole names
  });

  it("unfold a path with whatever folded it, keeping folds below it", () => {
    expect(withFolded(paths, "src/", true)).toEqual(new Set([...paths, "src/"]));
    expect(withFolded(paths, "bench/x/", false)).toEqual(new Set(["src/app/", "src/main.py"]));
    const nested = new Set(["a/", "a/b/", "a/b/c.py"]);
    expect(withFolded(nested, "a/b/", false)).toEqual(new Set(["a/b/c.py"]));
    expect(withFolded(nested, "a/", false)).toEqual(new Set(["a/b/", "a/b/c.py"]));
    expect(unfolding(paths, ["src/main.py", "bench/x/y.py"])).toEqual(new Set(["src/app/"]));
  });
});

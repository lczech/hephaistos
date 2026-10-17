import type { Atom } from "@tanstack/react-store";
import type { DiffLook } from "../../components/diff/Diff";
import { keptAtom } from "../../kept";

const DEFAULT_LOOK: DiffLook = { split: true, wrap: false, whole: false };

/** How diffs show, chosen in any Diff View: for all of them, kept in this browser. */
export function diffLook(): Atom<DiffLook> {
  return keptAtom("hephaistos.diff", (saved) => {
    const look = { ...DEFAULT_LOOK };
    if (typeof saved !== "object" || saved === null) return look;
    for (const key of Object.keys(look) as (keyof DiffLook)[]) {
      const value = (saved as Record<string, unknown>)[key];
      if (typeof value === "boolean") look[key] = value;
    }
    return look;
  });
}

import type { Atom } from "@tanstack/react-store";
import { keptAtom } from "../../kept";

/** How the changes since HEAD show: staged ones apart, as `git status` groups them, or not. */
export type ChangesLook = { grouped: boolean };

/** How changes show, chosen in any Changes View: for all of them, kept in this browser. */
export function changesLook(): Atom<ChangesLook> {
  return keptAtom("hephaistos.changes", (saved) => {
    const grouped = (saved as Partial<ChangesLook> | null)?.grouped;
    return { grouped: typeof grouped === "boolean" ? grouped : true };
  });
}

import { type Atom, useAtom } from "@tanstack/react-store";
import { Folders, FolderTree } from "lucide-react";
import { Choice } from "../../components/ViewBar";
import { keptAtom } from "../../kept";

/**
 * How changes show: those since HEAD with staged ones apart, as `git status` groups them, or
 * not; directories nested in their parents, or each by its path.
 */
export type ChangesLook = { grouped: boolean; nested: boolean };

/** How changes show, chosen in any Changes or Diff View: for all of them, kept in this browser. */
export function changesLook(): Atom<ChangesLook> {
  return keptAtom("hephaistos.changes", (saved) => {
    const { grouped, nested } = (saved as Partial<ChangesLook> | null) ?? {};
    return {
      grouped: typeof grouped === "boolean" ? grouped : true,
      nested: typeof nested === "boolean" ? nested : false,
    };
  });
}

/** The choice of directories nested or each by its path, for Changes and Diff Views alike. */
export function NestedChoice() {
  const [look, setLook] = useAtom(changesLook());
  return (
    <Choice
      label="Directories as a tree"
      on={look.nested}
      onChange={(nested) => setLook({ ...look, nested })}
      ways={[
        { icon: FolderTree, title: "Show directories as a tree, each in its parent" },
        { icon: Folders, title: "Show each directory with changes by its path" },
      ]}
    />
  );
}

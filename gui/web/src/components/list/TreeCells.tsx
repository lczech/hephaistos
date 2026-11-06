// Cells of a list's tree: what a row is, a step further in for each level within others; its
// chevron moved as far, so that it stands before its row; guides below the chevrons; and notes
// standing in for rows.

import type { ReactNode } from "react";
import { cssVars } from "../cssVars";
import { Chevron } from "./List";
import styles from "./TreeCells.module.css";
import type { Note } from "./tree";

/** What a row is, a step further in for each level of `depth`. */
export function Indented({ depth, children }: { depth: number; children: ReactNode }) {
  return (
    <span className={styles.indented} style={cssVars({ "--indent": Math.max(0, depth) })}>
      {children}
    </span>
  );
}

/** A row's chevron, in its square, moved as far in as its row's `depth`, before what it is. */
export function TreeChevron({ depth }: { depth: number }) {
  return (
    <span className={styles.moved} style={cssVars({ "--indent": Math.max(0, depth) })}>
      <Chevron />
    </span>
  );
}

/**
 * A row's guides: a line below each of the chevrons of the rows it is within, `depth` of them,
 * shown while the list is hovered. In its square, before or instead of its chevron.
 */
export function TreeGuides({ depth }: { depth: number }) {
  if (depth <= 0) return null;
  return (
    <span className={styles.guides} style={cssVars({ "--indent": depth })} aria-hidden="true" />
  );
}

/** What a note says, quieter, or as a problem. */
export function NoteText({ note }: { note: Note }) {
  return <span className={note.problem ? styles.problem : styles.note}>{note.text}</span>;
}

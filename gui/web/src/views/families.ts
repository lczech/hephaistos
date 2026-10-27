import styles from "./families.module.css";
import { viewKind } from "./kinds";

/** The class giving what holds a kind's icon its family's colour, for the icon to take. */
export function familyClass(kind: string): string | undefined {
  const known = viewKind(kind);
  return known && styles[known.family];
}

/** The classes of a kind's icon on its own (a `TextIcon`): in its family's colour. */
export function viewIconClass(kind: string): string | undefined {
  const family = familyClass(kind);
  return family && `${family} ${styles.icon}`;
}

/** The class of a kind's icon inside what has its `familyClass`. */
export const familyIcon = styles.icon;

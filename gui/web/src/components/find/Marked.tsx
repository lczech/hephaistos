import type { ReactNode } from "react";
import styles from "./Marked.module.css";

/**
 * Text with its matches marked, as the find row's marks look; all stronger where `current`, the
 * match stepped to. For text drawn here; the CSS Custom Highlight API marks others' (`marks.ts`).
 */
export function Marked({
  text,
  marks,
  current,
}: {
  text: string;
  marks: readonly [number, number][];
  current: boolean;
}) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of marks) {
    if (start < at || end > text.length) continue; // overlapping, or beyond the text
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className={current ? styles.current : styles.mark}>
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

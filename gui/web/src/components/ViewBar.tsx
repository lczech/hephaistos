import { type LucideIcon, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./ViewBar.module.css";

/** A View's bar above what it shows: what it shows and how, and its buttons. */
export function ViewBar({ children }: { children: ReactNode }) {
  return <header className={styles.bar}>{children}</header>;
}

/** One of a Choice's two ways: its icon, and what it does, at length. */
export interface Way {
  icon: LucideIcon;
  title: string;
}

interface ChoiceProps {
  label: string; // the first way's name
  on: boolean | undefined; // whether the first way is taken; neither, where things are mixed
  onChange: (on: boolean) => void;
  ways: [Way, Way]; // the first, then the other
}

/** A choice between two ways of showing something: both icons, the one taken marked; a click
 * takes the other, or where neither is, the first. */
export function Choice({ label, on, onChange, ways }: ChoiceProps) {
  return (
    <button
      type="button"
      className={styles.choice}
      aria-label={label}
      aria-pressed={on ?? "mixed"}
      onClick={() => onChange(!on)}
    >
      {ways.map(({ icon: Icon, title }, i) => (
        <span key={title} title={title} data-taken={(i === 0) === on || undefined}>
          <Icon aria-hidden="true" />
        </span>
      ))}
    </button>
  );
}

/** The bar's end, after what it says: its buttons, then Refresh. */
export function BarEnd({ children }: { children: ReactNode }) {
  return <div className={styles.end}>{children}</div>;
}

/** Asks again for what the View shows, turning while it does; at the bar's end. */
export function Refresh({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={styles.refresh}
      onClick={onClick}
      title="Refresh"
      aria-label="Refresh"
      data-busy={busy || undefined}
    >
      <RefreshCw aria-hidden="true" />
    </button>
  );
}

import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./ViewBar.module.css";

/** A View's bar above what it shows: what it shows and how, and its buttons. */
export function ViewBar({ children }: { children: ReactNode }) {
  return <header className={styles.bar}>{children}</header>;
}

interface ToggleProps {
  on: boolean;
  onChange: (on: boolean) => void;
  title: string; // what it does, at length
  children: ReactNode; // its label
}

/** A choice on or off, pressed while on. */
export function Toggle({ on, onChange, title, children }: ToggleProps) {
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-pressed={on}
      onClick={() => onChange(!on)}
      title={title}
    >
      {children}
    </button>
  );
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

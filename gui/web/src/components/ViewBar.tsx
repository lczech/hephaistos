import { type LucideIcon, RefreshCw } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import controls from "./controls.module.css";
import { IconButton } from "./IconButton";
import styles from "./ViewBar.module.css";

/** A View of a bar and what is below it, as high as its Panel: a list there scrolls itself. */
export function ViewPage({ children }: { children: ReactNode }) {
  return <section className={styles.page}>{children}</section>;
}

/** A View's bar above what it shows: what it shows and how, and its buttons. */
export function ViewBar({ children }: { children: ReactNode }) {
  return <header className={styles.bar}>{children}</header>;
}

/** A toggle's icon, and what it does, at length: its one, or one of its two modes'. */
export interface Way {
  icon: LucideIcon;
  title: string;
}

interface ToggleProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "children" | "title" | "type" | "onChange"
  > {
  label: string; // what it turns on, or its first mode's name
  on: boolean | undefined; // whether it, or its first mode, is on; neither where things are mixed
  onChange: (on: boolean) => void;
  ways: [Way] | [Way, Way]; // its icon; or its first mode's, then the other's
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Something on or off, by one icon, marked while on; or two modes, by both icons, the one in
 * effect marked: a click switches to the other, or where neither is, to the first.
 */
export function Toggle({ label, on, onChange, ways, className, ...props }: ToggleProps) {
  const [first, second] = ways;
  const look = second === undefined ? controls.icon : styles.modes;
  return (
    <button
      type="button"
      className={className ? `${look} ${className}` : look}
      aria-label={label}
      title={second === undefined ? first.title : undefined}
      aria-pressed={on ?? "mixed"}
      onClick={() => onChange(!on)}
      {...props}
    >
      {second === undefined ? (
        <first.icon aria-hidden="true" />
      ) : (
        [first, second].map(({ icon: Icon, title }, i) => (
          <span key={title} title={title} data-on={(i === 0) === on || undefined}>
            <Icon aria-hidden="true" />
          </span>
        ))
      )}
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
    <IconButton
      icon={RefreshCw}
      label="Refresh"
      className={styles.refresh}
      onClick={onClick}
      data-busy={busy || undefined}
    />
  );
}

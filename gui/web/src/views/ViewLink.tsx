import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Address } from "./address";
import { viewIcon, viewKind } from "./kinds";
import { clickOpening, useOpenView } from "./opening";
import styles from "./ViewLink.module.css";

interface Props {
  address: Address;
  label: string; // what it shows: `The Daemon's log`
  named?: boolean; // the kind's name after its icon, where there's room: `Log`
  icon?: LucideIcon; // instead of the kind's
  children?: ReactNode; // after the icon, instead of the kind's name: a commit's hash
  quiet?: boolean; // greyed out, when what it shows needs no look, e.g. no changes
  note?: string; // after the label in its tooltip: `no changes`
}

/**
 * A button with a kind's icon that shows a View, as a preview: in its Group, or beside it by the
 * middle button or Alt.
 */
export function ViewLink({ address, label, named = false, icon, children, quiet, note }: Props) {
  const open = useOpenView();
  const kind = viewKind(address.kind);
  const Icon = icon ?? viewIcon(address);
  return (
    <button
      type="button"
      className={[
        styles.link,
        named && styles.named,
        children !== undefined && styles.text,
        quiet && styles.quiet,
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={(event) => open(address, clickOpening(event))}
      onAuxClick={(event) => event.button === 1 && open(address, clickOpening(event))}
      title={note === undefined ? label : `${label}: ${note}`}
      aria-label={label}
    >
      {Icon ? <Icon aria-hidden="true" /> : "→"}
      {children ?? (named && kind?.name)}
    </button>
  );
}

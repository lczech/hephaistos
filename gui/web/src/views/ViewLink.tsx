import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Address } from "./address";
import { viewKind } from "./kinds";
import { type Opening, useOpenView } from "./opening";
import styles from "./ViewLink.module.css";

interface Props {
  address: Address;
  label: string; // what it shows: `The Daemon's log`
  opening?: Opening;
  named?: boolean; // the kind's name after its icon, where there's room: `Log`
  icon?: LucideIcon; // instead of the kind's
  children?: ReactNode; // after the icon, instead of the kind's name: a commit's hash
  quiet?: boolean; // greyed out, when what it shows needs no look, e.g. no changes
  note?: string; // after the label in its tooltip: `no changes`
}

/** A button with a kind's icon that shows a View; a double-click keeps a preview it opened. */
export function ViewLink({
  address,
  label,
  opening,
  named = false,
  icon,
  children,
  quiet,
  note,
}: Props) {
  const open = useOpenView();
  const kind = viewKind(address.kind);
  const Icon = icon ?? kind?.icon;
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
      onClick={() => open(address, opening)}
      onDoubleClick={() => open(address, { ...opening, preview: false })}
      title={note === undefined ? label : `${label}: ${note}`}
      aria-label={label}
    >
      {Icon ? <Icon aria-hidden="true" /> : "→"}
      {children ?? (named && kind?.name)}
    </button>
  );
}

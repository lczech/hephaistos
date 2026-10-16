import type { Address } from "./address";
import { viewKind } from "./kinds";
import { type Opening, useOpenView } from "./opening";
import styles from "./ViewLink.module.css";

interface Props {
  address: Address;
  label: string; // what it shows: `The Daemon's log`
  opening?: Opening;
  named?: boolean; // the kind's name after its icon, where there's room: `Log`
}

/** A button with a kind's icon that shows a View; a double-click keeps a preview it opened. */
export function ViewLink({ address, label, opening, named = false }: Props) {
  const open = useOpenView();
  const kind = viewKind(address.kind);
  const Icon = kind?.icon;
  return (
    <button
      type="button"
      className={named ? `${styles.link} ${styles.named}` : styles.link}
      onClick={() => open(address, opening)}
      onDoubleClick={() => open(address, { ...opening, preview: false })}
      title={label}
      aria-label={label}
    >
      {Icon ? <Icon aria-hidden="true" /> : "→"}
      {named && kind?.name}
    </button>
  );
}

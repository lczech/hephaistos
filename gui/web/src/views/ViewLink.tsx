import type { Address } from "./address";
import { viewKind } from "./kinds";
import { useOpenView } from "./opening";
import styles from "./ViewLink.module.css";

interface Props {
  address: Address;
  label: string; // what it shows: `The Daemon's log`
}

/** A button with a kind's icon that shows a View. */
export function ViewLink({ address, label }: Props) {
  const open = useOpenView();
  const Icon = viewKind(address.kind)?.icon;
  return (
    <button
      type="button"
      className={styles.link}
      onClick={() => open(address)}
      title={label}
      aria-label={label}
    >
      {Icon ? <Icon aria-hidden="true" /> : "→"}
    </button>
  );
}

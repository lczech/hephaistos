import { ArrowRightLeft } from "lucide-react";
import {
  type FixedRow,
  GitRevisionPicker,
  type KnownRefs,
} from "../../components/GitRevisionPicker";
import { IconButton } from "../../components/IconButton";
import { HEAD, INDEX, WORKING_TREE } from "../../revisions";
import styles from "./ComparedPickers.module.css";
import type { Checkout } from "./checkout";
import type { Compared } from "./rows";

const ROWS: FixedRow[] = [WORKING_TREE, INDEX, HEAD];

interface Props {
  checkout: Checkout;
  compared: Compared;
  onChange: (compared: Compared) => void;
  /** The refs as known already, e.g. HEAD's branch, to show them while the pickers are closed. */
  known?: KnownRefs;
}

/** Two Revisions compared, from and to, each to pick, in a View's bar; and a button to swap them. */
export function ComparedPickers({ checkout, compared, onChange, known }: Props) {
  const picker = (side: keyof Compared, label: string) => (
    <GitRevisionPicker
      className={styles.picker}
      checkout={checkout}
      label={label}
      title={`${label}: a commit, branch or tag, the index, or the working tree`}
      value={compared[side]}
      onChange={(revision) => onChange({ ...compared, [side]: revision })}
      rows={ROWS}
      tabs={["branches", "tags", "commits"]}
      commitsFrom="everywhere"
      known={known}
    />
  );
  return (
    <div className={styles.compared}>
      {picker("from", "Compare from")}
      <IconButton
        icon={ArrowRightLeft}
        label="Swap"
        title="Swap: compare the other way"
        onClick={() => onChange({ from: compared.to, to: compared.from })}
      />
      {picker("to", "Compare to")}
    </div>
  );
}

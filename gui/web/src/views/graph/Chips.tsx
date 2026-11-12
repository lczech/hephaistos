import { cssVars } from "../../components/cssVars";
import { entityIcon } from "../../icons";
import styles from "./Chips.module.css";
import { checkedOutText, standingText, standingWords } from "./text";

/** A Checkout of the Clone, as its chip shows it. */
export interface Chip {
  key: string; // its path
  name: string;
  worktree: boolean;
  branch: string | null;
  commit: string | null;
  ahead: number | null;
  behind: number | null;
  against: string | null;
  colour: string; // of its branch's line
  hidden: boolean; // its branch is hidden by the filter
}

/**
 * A chip per Checkout of the Clone, below the bar: where it is, in the colour of its branch, and
 * how far it is ahead of the default branch and behind it. A click goes to its HEAD.
 */
export function Chips({
  chips,
  current,
  onPick,
}: {
  chips: Chip[];
  current: string | undefined;
  onPick: (chip: Chip) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <nav className={styles.chips} aria-label="Checkouts">
      {chips.map((chip) => {
        const Icon = entityIcon(chip.worktree ? "worktree" : "clone");
        const where = checkedOutText(chip.branch, chip.commit);
        const standing = standingText(chip.ahead, chip.behind);
        const words = standingWords(chip.ahead, chip.behind, chip.against);
        const kind = chip.worktree ? "Worktree" : "Clone";
        const title = [
          `${kind} ${chip.name}: ${where}`,
          ...(words ? [words] : []),
          chip.hidden ? "hidden by the filter; a click shows it" : "a click goes to its HEAD",
        ].join("; ");
        return (
          <button
            key={chip.key}
            type="button"
            className={styles.chip}
            title={title}
            aria-label={`${kind} ${chip.name}`}
            aria-current={chip.key === current || undefined}
            data-hidden={chip.hidden || undefined}
            style={cssVars({ "--chip-colour": chip.colour })}
            onClick={() => onPick(chip)}
          >
            <Icon aria-hidden="true" />
            <span className={styles.name}>{chip.name}</span>
            <span className={styles.where}>{where}</span>
            {standing && <span className={styles.standing}>{standing}</span>}
          </button>
        );
      })}
    </nav>
  );
}

import { LoaderCircle, TriangleAlert } from "lucide-react";
import { cssVars } from "../../components/cssVars";
import text from "../../components/text.module.css";
import turning from "../../components/turning.module.css";
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
  colour: string | undefined; // of the line of its HEAD; undefined while not known
  hidden: boolean; // its branch is hidden by the filter
}

interface Props {
  chips: Chip[];
  current: string | undefined; // the key of the chip marked
  // To the HEAD of a chip, once it takes a while, and how far it got: `Loading towards main`,
  // `3 commits so far`; the first said to screen readers once, not again for each page.
  going?: { key: string; what: string; far: string } | undefined;
  missed?: string | undefined; // the key of the chip whose HEAD no page listed
  onPick: (chip: Chip) => void;
}

/**
 * A chip per Checkout of the Clone, below the bar: where it is, marked at its start in the colour
 * of the line its HEAD is on, and how far it is ahead of the default branch and behind it. A
 * click goes to its HEAD; while it loads older commits to get there, the chip turns, and a click
 * on it stops. It is said in its tooltip and to screen readers, not in a note above the list,
 * which would move it.
 */
export function Chips({ chips, current, going, missed, onPick }: Props) {
  if (chips.length === 0) return null;
  const said = chips.find((chip) => chip.key === missed);
  return (
    <nav className={styles.chips} aria-label="Checkouts">
      <span className={text.unseen} aria-live="polite">
        {going?.what ?? (said && missedText(said.name))}
      </span>
      {chips.map((chip) => {
        const busy = chip.key === going?.key;
        const lost = chip.key === missed;
        let Icon = entityIcon(chip.worktree ? "worktree" : "clone");
        if (busy) Icon = LoaderCircle;
        else if (lost) Icon = TriangleAlert;
        const where = checkedOutText(chip.branch, chip.commit);
        const standing = standingText(chip.ahead, chip.behind);
        const words = standingWords(chip.ahead, chip.behind, chip.against);
        const kind = chip.worktree ? "Worktree" : "Clone";
        let action = chip.hidden
          ? "hidden by the filter; a click shows it"
          : "a click goes to its HEAD";
        if (busy && going) action = `${going.what}: ${going.far}; a click or Escape stops`;
        else if (lost) action = `${missedText(chip.name)}; a click tries again`;
        const title = [`${kind} ${chip.name}: ${where}`, ...(words ? [words] : []), action].join(
          "; ",
        );
        return (
          <button
            key={chip.key}
            type="button"
            className={styles.chip}
            title={title}
            aria-label={`${kind} ${chip.name}`}
            aria-current={chip.key === current || undefined}
            data-hidden={chip.hidden || undefined}
            data-busy={busy || undefined}
            data-missed={lost || undefined}
            style={cssVars(chip.colour === undefined ? {} : { "--chip-colour": chip.colour })}
            onClick={() => onPick(chip)}
          >
            <Icon className={busy ? turning.turning : undefined} aria-hidden="true" />
            <span className={styles.name}>{chip.name}</span>
            <span className={styles.where}>{where}</span>
            {standing && <span className={styles.standing}>{standing}</span>}
          </button>
        );
      })}
    </nav>
  );
}

function missedText(name: string): string {
  return `The HEAD of ${name} is not among the commits shown`;
}

import { ChevronRight, GitCompare, GitMerge } from "lucide-react";
import type { Schemas } from "../../api/client";
import { IconButton } from "../../components/IconButton";
import { TextIcon } from "../../components/TextIcon";
import { COMMIT_ICON } from "../../icons";
import { shortHash } from "../../revisions";
import type { Checkout } from "../changes/checkout";
import { CommitBox, CommitHash, RefLabels } from "./CommitBox";
import styles from "./CommitBox.module.css";

type Shown = Schemas["ShownCommitJson"];

interface LineProps {
  shown: Shown;
  checkout: Checkout;
  open: boolean;
  onToggle: () => void;
  /** To compare other Revisions instead, from its first parent to it; none for a root commit. */
  onCompare?: () => void;
}

/**
 * A commit whose changes are shown, in one line in the View's bar, where two Revisions compared
 * would be: it opens all about the commit below the bar (`CommitBelow`); a button at its end
 * compares other Revisions instead.
 */
export function CommitLine({ shown, checkout, open, onToggle, onCompare }: LineProps) {
  const { commit } = shown;
  if (commit === null) {
    return (
      <p className={styles.gone}>
        {shortHash(shown.name)} is no longer in this checkout.
        <Amended shown={shown} checkout={checkout} />
      </p>
    );
  }
  return (
    <div className={styles.header}>
      <button
        type="button"
        className={styles.line}
        aria-expanded={open}
        onClick={onToggle}
        title="Show commit details"
      >
        <ChevronRight className={styles.chevron} aria-hidden="true" />
        <span className={styles.commit}>
          <TextIcon icon={COMMIT_ICON} className={styles.icon} />
          <span className={styles.hash}>{shortHash(commit.hash)}</span>
        </span>
        <RefLabels refs={commit.refs} />
        {commit.parents.length > 1 && (
          <TextIcon icon={GitMerge} className={styles.icon} label="Merge commit" />
        )}
        <span className={styles.lineSubject}>{commit.subject}</span>
      </button>
      {onCompare && (
        <IconButton
          icon={GitCompare}
          label="Compare with other revisions"
          title="Compare with other revisions: from its first parent to it, then pick others"
          onClick={onCompare}
        />
      )}
    </div>
  );
}

/**
 * Below the bar with a commit's line: whether nothing leads to the commit any more, and what
 * amends of it led to; all about it, while open.
 */
export function CommitBelow({
  shown,
  checkout,
  now,
  open,
}: {
  shown: Shown;
  checkout: Checkout;
  now: number;
  open: boolean;
}) {
  const { commit } = shown;
  if (commit === null) return null;
  return (
    <>
      {!shown.reachable && (
        <p className={styles.gone}>
          Not on any branch or tag: amended, rebased, or reset away.
          <Amended shown={shown} checkout={checkout} />
        </p>
      )}
      {open && (
        <div className={styles.below}>
          <div className={styles.frame}>
            <CommitBox commit={commit} checkout={checkout} now={now} />
          </div>
        </div>
      )}
    </>
  );
}

function Amended({ shown, checkout }: { shown: Shown; checkout: Checkout }) {
  if (!shown.amended_as) return null;
  return (
    <>
      {" "}
      Amended as <CommitHash hash={shown.amended_as} checkout={checkout} />.
    </>
  );
}

import { ChevronRight, GitCommitVertical, GitMerge } from "lucide-react";
import { useState } from "react";
import type { Schemas } from "../../api/client";
import { ago, fullTime } from "../../time";
import type { Checkout } from "../changes/checkout";
import { CommitBox, CommitLink, RefLabels } from "./CommitBox";
import styles from "./CommitBox.module.css";
import { shortHash } from "./rows";

interface Props {
  shown: Schemas["ShownCommitJson"];
  checkout: Checkout;
  now: number;
}

/**
 * Above a commit's changes: the commit in one line, which opens all about it below; whether
 * nothing leads to it any more, and what amends of it led to.
 */
export function CommitHeader({ shown, checkout, now }: Props) {
  const [open, setOpen] = useState(false);
  const { commit } = shown;
  const amended = shown.amended_as && (
    <>
      {" "}
      Amended as <CommitLink hash={shown.amended_as} checkout={checkout} />.
    </>
  );
  if (commit === null) {
    return (
      <p className={styles.gone}>
        {shortHash(shown.name)} is no longer in this Checkout.{amended}
      </p>
    );
  }
  return (
    <div className={styles.header}>
      <button
        type="button"
        className={styles.line}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title="All about the commit"
      >
        <ChevronRight className={styles.chevron} aria-hidden="true" />
        <GitCommitVertical className={styles.icon} aria-hidden="true" />
        <span className={styles.hash}>{shortHash(commit.hash)}</span>
        <RefLabels refs={commit.refs} />
        {commit.parents.length > 1 && (
          <GitMerge className={styles.icon} aria-label="merge: against its first parent" />
        )}
        <span className={styles.lineSubject}>{commit.subject}</span>
        <span className={styles.by} title={fullTime(commit.author.at)}>
          {commit.author.name}, {ago(commit.author.at, now)}
        </span>
      </button>
      {!shown.reachable && (
        <p className={styles.gone}>
          Not on any branch or tag: amended, rebased, or reset away.{amended}
        </p>
      )}
      {open && (
        <div className={styles.frame}>
          <CommitBox commit={commit} checkout={checkout} now={now} />
        </div>
      )}
    </div>
  );
}

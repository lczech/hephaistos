import type { ReactNode } from "react";
import { TextIcon } from "../../components/TextIcon";
import { Fields } from "../../components/table/Fields";
import { COMMIT_ICON, HEAD_ICON, REF_ICONS } from "../../icons";
import { shortHash } from "../../revisions";
import { ago, fullTime } from "../../time";
import { ChangesLinks } from "../changes/ChangesLinks";
import type { Checkout } from "../changes/checkout";
import styles from "./CommitBox.module.css";
import { type Commit, committedApart, type Ref } from "./rows";

/**
 * A commit as named wherever it is shown but in pickers and the bar: its icon and its hash, as
 * text, then its Changes and Diff. Without a hash, the uncommitted changes, lined up the same.
 */
export function CommitHash({ hash, checkout }: { hash: string | undefined; checkout: Checkout }) {
  return (
    <span className={styles.named}>
      {hash === undefined ? (
        <span className={styles.slot} />
      ) : (
        <TextIcon icon={COMMIT_ICON} className={styles.mark} />
      )}
      <span className={styles.hash}>{hash && shortHash(hash)}</span>
      <ChangesLinks
        checkout={checkout}
        commit={hash}
        what={hash === undefined ? "uncommitted changes" : `changes in commit ${shortHash(hash)}`}
      />
    </span>
  );
}

/** The branches and tags pointing at a commit, and HEAD if it does, as labels. */
export function RefLabels({ refs, head }: { refs: Ref[]; head?: boolean }) {
  if (refs.length === 0 && !head) return null;
  return (
    <span className={styles.refs}>
      {head && (
        <span className={styles.ref} title="HEAD: the commit checked out">
          <HEAD_ICON aria-hidden="true" />
          HEAD
        </span>
      )}
      {refs.map((ref) => {
        const Icon = REF_ICONS[ref.kind];
        return (
          <span key={`${ref.kind}:${ref.name}`} className={styles.ref} title={REF_KINDS[ref.kind]}>
            <Icon aria-hidden="true" />
            {ref.name}
          </span>
        );
      })}
    </span>
  );
}

const REF_KINDS: Record<Ref["kind"], string> = {
  branch: "branch",
  remote: "remote-tracking branch",
  tag: "tag",
};

/** A commit as far as it is known: from git, all of it; from an Event, its hash and message. */
export type KnownCommit = Pick<Commit, "hash" | "subject" | "body"> &
  Partial<Pick<Commit, "author" | "committer" | "parents" | "refs">>;

interface Props {
  commit: KnownCommit;
  checkout: Checkout;
  now: number;
  heading?: boolean; // its hash and refs first, where nothing above shows them
}

/** All about a commit: its hash and refs, its whole message, who wrote and committed it, when,
 * and what it follows, as far as it is known. */
export function CommitBox({ commit, checkout, now, heading }: Props) {
  const when = (at: string) => `${fullTime(at)} (${ago(at, now)})`;
  const person = ({ name, email }: Commit["author"]) => `${name} <${email}>`;
  const { author, committer, parents } = commit;
  const fields: [string, ReactNode][] = [];
  if (author !== undefined) fields.push(["author", person(author)], ["authored", when(author.at)]);
  if (author !== undefined && committer !== undefined) {
    if (committedApart(author, committer)) fields.push(["committer", person(committer)]);
    fields.push(["committed", when(committer.at)]);
  }
  if (parents !== undefined) {
    const links = parents.map((parent) => (
      <CommitHash key={parent} hash={parent} checkout={checkout} />
    ));
    const shown = links.length ? (
      <span className={styles.parents}>{links}</span>
    ) : (
      "none: the first"
    );
    fields.push([parents.length > 1 ? "parents" : "parent", shown]);
  }
  return (
    <div className={styles.box}>
      {heading && (
        <p className={styles.top}>
          <CommitHash hash={commit.hash} checkout={checkout} />
          <RefLabels refs={commit.refs ?? []} />
        </p>
      )}
      <p className={styles.subject}>{commit.subject}</p>
      {commit.body && <p className={styles.body}>{commit.body}</p>}
      {fields.length > 0 && <Fields fields={fields} />}
    </div>
  );
}

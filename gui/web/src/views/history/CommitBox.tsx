import type { ReactNode } from "react";
import { TextIcon } from "../../components/TextIcon";
import { Fields } from "../../components/table/Fields";
import { COMMIT_ICON, HEAD_ICON, REF_ICONS } from "../../icons";
import { SINCE_HEAD, shortHash } from "../../revisions";
import { numberText, plural } from "../../text";
import { timeAndAgo } from "../../time";
import { ChangesLinks } from "../changes/ChangesLinks";
import type { Checkout } from "../changes/checkout";
import { changesText } from "../changes/rows";
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
        what={changesText(hash === undefined ? SINCE_HEAD : { commit: hash })}
      />
    </span>
  );
}

const SHOWN_LABELS = 2; // on a line, HEAD first, then main or master, then the others; the rest counted

/**
 * The branches and tags pointing at a commit, and HEAD if it does, as labels: on a line, a few,
 * so its subject still shows, and how many more; all where `all`.
 */
export function RefLabels({ refs, head, all }: { refs: Ref[]; head?: boolean; all?: boolean }) {
  if (refs.length === 0 && !head) return null;
  const first = [...refs].sort((a, b) => Number(isMain(b)) - Number(isMain(a)));
  const room = all ? first.length : SHOWN_LABELS - (head ? 1 : 0);
  const shown = first.slice(0, room);
  const more = first.slice(room);
  return (
    <span className={styles.refs}>
      {head && (
        <span className={styles.ref} title="HEAD: the commit checked out">
          <HEAD_ICON aria-hidden="true" />
          HEAD
        </span>
      )}
      {shown.map((ref) => {
        const Icon = REF_ICONS[ref.kind];
        return (
          <span key={`${ref.kind}:${ref.name}`} className={styles.ref} title={REF_KINDS[ref.kind]}>
            <Icon aria-hidden="true" />
            {ref.name}
          </span>
        );
      })}
      {more.length > 0 && (
        <span className={styles.more} title={more.map((ref) => ref.name).join(", ")}>
          +{numberText(more.length)}
        </span>
      )}
    </span>
  );
}

function isMain(ref: Ref): boolean {
  return ref.kind === "branch" && (ref.name === "main" || ref.name === "master");
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
  const when = (at: string) => timeAndAgo(at, now);
  const person = ({ name, email }: Commit["author"]) => `${name} <${email}>`;
  const { author, committer, parents } = commit;
  const fields: [string, ReactNode][] = [];
  // Where a line above shows a few of them: all of them here.
  if (!heading && commit.refs?.length)
    fields.push(["refs", <RefLabels key="refs" refs={commit.refs} all />]);
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
    fields.push([plural(parents.length, "parent"), shown]);
  }
  return (
    <div className={styles.box}>
      {heading && (
        <p className={styles.top}>
          <CommitHash hash={commit.hash} checkout={checkout} />
          <RefLabels refs={commit.refs ?? []} all />
        </p>
      )}
      <p className={styles.subject}>{commit.subject}</p>
      {commit.body && <p className={styles.body}>{commit.body}</p>}
      {fields.length > 0 && <Fields fields={fields} />}
    </div>
  );
}

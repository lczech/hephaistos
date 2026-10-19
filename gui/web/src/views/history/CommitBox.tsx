import { GitCommitVertical, Tag } from "lucide-react";
import type { ReactNode } from "react";
import { Fields } from "../../components/table/Fields";
import { ago, fullTime } from "../../time";
import type { Checkout } from "../changes/checkout";
import { ViewLink } from "../ViewLink";
import styles from "./CommitBox.module.css";
import { type Commit, committedApart, type Ref, shortHash } from "./rows";

/** A commit's hash, as a link to its changes, opened beside as a preview. */
export function CommitLink({ hash, checkout }: { hash: string; checkout: Checkout }) {
  return (
    <ViewLink
      address={{ kind: "changes", params: { ...checkout, commit: hash } }}
      label={`Changes in commit ${shortHash(hash)}`}
      opening={{ beside: true, preview: true }}
      icon={GitCommitVertical}
    >
      <span className={styles.hash}>{shortHash(hash)}</span>
    </ViewLink>
  );
}

/** The branches and tags pointing at a commit, and HEAD if it does, as labels. */
export function RefLabels({ refs, head }: { refs: Ref[]; head?: boolean }) {
  if (refs.length === 0 && !head) return null;
  return (
    <span className={styles.refs}>
      {head && (
        <span className={styles.ref} data-kind="head" title="HEAD: the commit checked out">
          HEAD
        </span>
      )}
      {refs.map((ref) => (
        <span
          key={`${ref.kind}:${ref.name}`}
          className={styles.ref}
          data-kind={ref.kind}
          title={REF_KINDS[ref.kind]}
        >
          {ref.kind === "tag" && <Tag aria-hidden="true" />}
          {ref.name}
        </span>
      ))}
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
      <CommitLink key={parent} hash={parent} checkout={checkout} />
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
          <CommitLink hash={commit.hash} checkout={checkout} />
          <RefLabels refs={commit.refs ?? []} />
        </p>
      )}
      <p className={styles.subject}>{commit.subject}</p>
      {commit.body && <p className={styles.body}>{commit.body}</p>}
      {fields.length > 0 && <Fields fields={fields} />}
    </div>
  );
}

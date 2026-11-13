import type { ReactNode } from "react";
import { cssVars } from "../../components/cssVars";
import { Fields } from "../../components/list/Fields";
import { TextIcon } from "../../components/TextIcon";
import { COMMIT_ICON, entityIcon, HEAD_ICON, REF_ICONS } from "../../icons";
import { SINCE_HEAD, shortHash } from "../../revisions";
import { listText, numberText, plural } from "../../text";
import { timeAndAgo } from "../../time";
import type { Checkout } from "../checkout";
import { ChangesLinks } from "../comparison/ChangesLinks";
import { changesText } from "../comparison/rows";
import styles from "./CommitBox.module.css";
import { branchOf, type CheckedOut, type Commit, committedApart, type Ref } from "./rows";

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

interface RefLabelsProps {
  refs: Ref[];
  head?: boolean;
  all?: boolean;
  lead?: { name: string; colour: string }; // the branch whose line a graph draws, in its colour
  // The Checkouts at this commit, as a Graph marks them; its default branch, first among them.
  checkedOut?: CheckedOut[];
  first?: string;
}

/**
 * The branches and tags pointing at a commit, and HEAD if it does, as labels: on a line, a few,
 * so its subject still shows, and how many more; all where `all`. The branch leading the line of
 * a graph is framed in that line's colour, its remote-tracking branch too.
 *
 * In a Graph, a branch checked out says where, by the Clone's or Worktree's icon and name, and a
 * Checkout whose HEAD is detached has a label of its own, saying so. They come first, after HEAD: the
 * default branch, branches checked out, other local branches, remote-tracking ones, tags.
 */
export function RefLabels({ refs, head, all, lead, checkedOut = [], first }: RefLabelsProps) {
  const detached = checkedOut.filter((each) => each.branch === null);
  if (refs.length === 0 && !head && detached.length === 0) return null;
  const outIn = (ref: Ref) =>
    ref.kind === "branch" ? checkedOut.filter((each) => each.branch === ref.name) : [];
  const rank = (ref: Ref) => {
    if (first === undefined ? isMain(ref) : ref.kind === "branch" && ref.name === first) return 0;
    if (outIn(ref).length > 0) return 1;
    return { branch: 2, remote: 3, tag: 4 }[ref.kind];
  };
  const ordered = [...refs].sort((a, b) => rank(a) - rank(b));
  const room = all ? ordered.length : Math.max(SHOWN_LABELS - (head ? 1 : 0) - detached.length, 0);
  const shown = ordered.slice(0, room);
  const more = ordered.slice(room);
  return (
    <span className={styles.refs}>
      {head && (
        <span className={styles.ref} title="HEAD: the commit checked out">
          <HEAD_ICON aria-hidden="true" />
          HEAD
        </span>
      )}
      {detached.map((each) => (
        <span
          key={`head:${each.path}`}
          className={styles.ref}
          title={`HEAD of ${checkoutKind(each)} ${each.name}, detached at ${shortHash(each.commit ?? "")}`}
        >
          <HEAD_ICON aria-hidden="true" />
          detached
          <Where checkout={each} />
        </span>
      ))}
      {shown.map((ref) => {
        const Icon = REF_ICONS[ref.kind];
        const leads = lead !== undefined && ref.kind !== "tag" && branchOf([ref]) === lead.name;
        const where = outIn(ref);
        const title = where.length
          ? `${REF_KINDS[ref.kind]}, checked out in ${listText(where.map((each) => `${checkoutKind(each)} ${each.name}`))}`
          : REF_KINDS[ref.kind];
        return (
          <span
            key={`${ref.kind}:${ref.name}`}
            className={styles.ref}
            title={title}
            style={cssVars(leads ? { "--ref-colour": lead.colour } : {})}
          >
            <Icon aria-hidden="true" />
            {ref.name}
            {where.map((each) => (
              <Where key={each.path} checkout={each} />
            ))}
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

/** Where a Checkout is, inside a label: the icon of a Clone or a Worktree, and its name. */
function Where({ checkout }: { checkout: CheckedOut }) {
  const Icon = entityIcon(checkout.worktree ? "worktree" : "clone");
  return (
    <span className={styles.where}>
      <Icon aria-hidden="true" />
      {checkout.name}
    </span>
  );
}

function checkoutKind(checkout: CheckedOut): string {
  return checkout.worktree ? "worktree" : "clone";
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

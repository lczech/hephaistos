import type { Schemas } from "../../api/client";
import { SINCE_HEAD } from "../../revisions";
import { capitalised } from "../../text";
import type { Address } from "../address";
import type { Checkout } from "../checkout";
import { ViewLink } from "../ViewLink";

interface Props {
  checkout: Checkout;
  commit?: string; // its changes; without it, the uncommitted ones
  what: string; // what they are, lowercase: `changes in commit abc1234`, `uncommitted changes`
  state?: Counts; // the Checkout's, for its uncommitted changes: greyed out without any
}

/** What a Checkout's State counts of its uncommitted changes. */
type Counts = Pick<Schemas["CloneJson"], "staged" | "changed" | "conflicted" | "untracked">;

/** The two Views of a commit's changes, or of a Checkout's uncommitted ones. */
export function changesViews(checkout: Checkout, commit?: string): [Address, Address] {
  return [
    { kind: "changes", params: { ...checkout, ...(commit !== undefined && { commit }) } },
    // The Changes View takes no `from` and `to` as since HEAD; the Diff View needs them.
    { kind: "diff", params: { ...checkout, ...(commit === undefined ? SINCE_HEAD : { commit }) } },
  ];
}

/**
 * A commit's changes, or a Checkout's uncommitted ones, as their two Views: always both, in this
 * order: Changes, a list of the files, and Diff, all files one under the other.
 */
export function ChangesLinks({ checkout, commit, what, state }: Props) {
  const [changes, diff] = changesViews(checkout, commit);
  const label = capitalised(what);
  // Untracked files alone are often left there for good, so they do not call for a look.
  const quiet = state !== undefined && !(state.staged || state.changed || state.conflicted);
  const untracked = state?.untracked ? `; ${state.untracked} untracked` : "";
  const note = quiet ? `no changes${untracked}` : undefined;
  return (
    <>
      <ViewLink address={changes} label={label} quiet={quiet} note={note} />
      <ViewLink address={diff} label={`Diff of the ${what}`} quiet={quiet} note={note} />
    </>
  );
}

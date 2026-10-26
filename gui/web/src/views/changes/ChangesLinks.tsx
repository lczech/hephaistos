import { SINCE_HEAD } from "../../revisions";
import type { Address } from "../address";
import { ViewLink } from "../ViewLink";
import type { Checkout } from "./checkout";

interface Props {
  checkout: Checkout;
  commit?: string; // its changes; without it, the uncommitted ones
  what: string; // what they are, lowercase: `changes in commit abc1234`, `uncommitted changes`
  quiet?: boolean; // greyed out, as they need no look
  note?: string; // after the label in their tooltips: `no changes`
}

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
export function ChangesLinks({ checkout, commit, what, quiet, note }: Props) {
  const [changes, diff] = changesViews(checkout, commit);
  const label = what.charAt(0).toUpperCase() + what.slice(1);
  return (
    <>
      <ViewLink address={changes} label={label} quiet={quiet} note={note} />
      <ViewLink address={diff} label={`Diff of the ${what}`} quiet={quiet} note={note} />
    </>
  );
}

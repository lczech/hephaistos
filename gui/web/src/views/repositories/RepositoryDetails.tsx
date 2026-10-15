import { Fragment, type ReactNode } from "react";
import { ForgeLink } from "../../components/ForgeLink";
import { Fields } from "../../components/table/Fields";
import { forgePage } from "../../forges";
import { shortPath } from "../../paths";
import { ago, fullTime } from "../../time";
import { branchText, type Checkout, type Entry, statusText, worktreePath } from "./rows";

interface Props {
  entry: Entry;
  now: number;
  home: string | undefined;
}

type Field = [string, ReactNode];

/** A row's fields as `show` shows them, without those that are empty, and nothing the rows
 * around it say. */
export function RepositoryDetails({ entry, now, home }: Props) {
  const when = (at: string | null) => at && `${fullTime(at)} (${ago(at, now)})`;
  const checkoutFields = (state: Checkout): Field[] => [
    ["active", when(state.active_at)],
    ["observed", when(state.observed_at)],
    ["observed by", state.observed_by.name ?? state.observed_by.id],
    ["present", state.present],
    ["head", state.head],
    ["branch", branchText(state)],
    ["status", statusText(state)],
    ["upstream", state.upstream],
    ["ahead", state.ahead],
    ["behind", state.behind],
    ["staged", state.staged],
    ["changed", state.changed],
    ["untracked", state.untracked],
    ["conflicted", state.conflicted],
    ["error", state.error],
  ];
  let fields: Field[];
  if (entry.type === "repository") {
    const { repository } = entry;
    const remotes = repository.remotes.length > 0 ? <Remotes remotes={repository.remotes} /> : null;
    fields = [
      ["id", repository.id],
      ["created", when(repository.created_at)],
      ["active", when(repository.active_at)],
      ["clones", repository.clones.length],
      ["remotes", remotes],
    ];
  } else if (entry.type === "clone") {
    const { clone } = entry;
    fields = [
      ["id", clone.id],
      ["path", shortPath(clone.path, home)],
      ["resolved path", clone.resolved_path === clone.path ? null : clone.resolved_path],
      ["filesystem", clone.filesystem.name],
      ["created", when(clone.created_at)],
      ["bare", clone.bare],
      ...checkoutFields(clone),
      ["branches", clone.branches.join(", ")],
      ...Object.entries(clone.remotes).map(([name, url]): Field => [`remote ${name}`, url]),
      ["root commits", clone.root_commits.join(", ")],
    ];
  } else {
    const { worktree, clone } = entry;
    fields = [
      ["id", worktree.id],
      ["path", worktreePath(worktree, clone, home)],
      ["name", worktree.name],
      ["lock reason", worktree.lock_reason],
      ...checkoutFields(worktree),
    ];
  }
  return (
    <Fields
      fields={fields.flatMap(([label, value]): Field[] => {
        if (value === null || value === undefined || value === "") return [];
        if (typeof value === "boolean") return [[label, value ? "yes" : "no"]];
        return [[label, typeof value === "object" ? value : String(value)]];
      })}
    />
  );
}

/** Main remotes, each one on a forge as a link to its page there. */
function Remotes({ remotes }: { remotes: string[] }) {
  return remotes.map((remote, index) => {
    const page = forgePage(remote);
    return (
      <Fragment key={remote}>
        {index > 0 && ", "}
        {page ? <ForgeLink page={page} text /> : remote}
      </Fragment>
    );
  });
}

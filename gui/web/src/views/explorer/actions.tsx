// What can be done with an entry of the Explorer: its Diff and History, in a lane at its row's
// end and in its menu, which can also copy its path. Those Views need a registered Checkout.

import { Copy, CopySlash, FolderInput } from "lucide-react";
import type { Schemas } from "../../api/client";
import type { RowAction } from "../../components/list/RowMenu";
import { copyText } from "../../notice";
import { SINCE_HEAD, WORKING_TREE } from "../../revisions";
import { type Address, paramValues } from "../address";
import type { Checkout } from "../checkout";
import { viewIconClass } from "../families";
import { viewIcon } from "../kinds";
import type { OpenView } from "../opening";
import { ViewLink } from "../ViewLink";
import type { Entry } from "./rows";

type Shown = Extract<Entry, { type: "entry" }>;

/** A registered Checkout, by the paths it may be reached by: as registered, and resolved. */
export interface Known {
  checkout: Checkout;
  paths: string[];
}

/** The registered Checkouts, by their paths. */
export function knownCheckouts(repositories: Schemas["RepositoryJson"][]): Known[] {
  return repositories.flatMap((repository) =>
    repository.clones.flatMap((clone) => [
      { checkout: { clone: clone.id }, paths: [clone.path, clone.resolved_path] },
      ...clone.worktrees.map((worktree) => ({
        checkout: { worktree: worktree.id },
        paths: [worktree.path],
      })),
    ]),
  );
}

/**
 * Where an entry is in a registered Checkout: which, and its path in it, `src/main.py`; `""` for
 * the top of the Checkout itself.
 */
export interface Place {
  checkout: Checkout;
  relative: string;
}

/**
 * Where an entry is in its working tree's Checkout, `top` as git found it, if registered: by the
 * path the entry was reached by, as registered or resolved. A folder that is a registered
 * Checkout is its top, also where what holds it is no working tree, e.g. `~/Repos`.
 */
export function placeOf(row: Shown, top: string | undefined, known: Known[]): Place | undefined {
  const itself = known.find(({ paths }) => paths.includes(row.path));
  if (itself) return { checkout: itself.checkout, relative: "" };
  if (top === undefined) return undefined;
  const found = known.find(({ paths }) => paths.includes(top));
  if (found === undefined) return undefined;
  for (const path of new Set([...found.paths, top])) {
    if (row.path.startsWith(`${path}/`)) {
      return { checkout: found.checkout, relative: row.path.slice(path.length + 1) };
    }
  }
  return undefined;
}

/** An entry's Diff, since HEAD: of a file with changes. */
function diffOf(row: Shown, place: Place | undefined): Address | undefined {
  const { status, ignored } = row.entry;
  if (place === undefined || row.folder || status === null || ignored) return undefined;
  return { kind: "diff", params: { ...place.checkout, ...SINCE_HEAD, path: place.relative } };
}

/**
 * An entry's History: the commits that changed it, or what is below it; all, for a top. None
 * for what git ignores or does not track: git says so only of what it has no commits of.
 */
function historyOf(row: Shown, place: Place | undefined): Address | undefined {
  const { status, ignored } = row.entry;
  if (place === undefined || ignored || status === "?") return undefined;
  const { checkout, relative } = place;
  return { kind: "history", params: relative === "" ? checkout : { ...checkout, path: relative } };
}

/**
 * Whether a View shown is about a file as the Explorer shows it, on disk: its Diff, comparing
 * the working tree with anything, either way, in its Checkout. Not a commit's or the staged.
 */
export function showsFile(shown: Address, place: Place | undefined): boolean {
  if (place === undefined || shown.kind !== "diff") return false;
  const one = (name: string) => paramValues(shown.params[name])[0];
  const checkout = place.checkout;
  const same =
    "clone" in checkout ? one("clone") === checkout.clone : one("worktree") === checkout.worktree;
  const working = one("from") === WORKING_TREE || one("to") === WORKING_TREE;
  return same && working && one("path") === place.relative;
}

/** A row's links to its Views, packed at its end: its History last, its Diff before it. */
export function RowActions({ row, place }: { row: Shown; place: Place | undefined }) {
  const diff = diffOf(row, place);
  const history = historyOf(row, place);
  const name = row.shown;
  return (
    <>
      {diff && <ViewLink address={diff} label={`Diff of ${name}`} />}
      {history && <ViewLink address={history} label={`Commit history of ${name}`} />}
    </>
  );
}

/** A View in a row's menu, by its icon in its family's colour. */
function opening(id: string, label: string, address: Address, openView: OpenView): RowAction {
  return {
    id,
    label,
    icon: viewIcon(address) ?? Copy,
    iconClass: viewIconClass(address.kind),
    onAction: () => openView(address, { preview: true }),
  };
}

/**
 * A row's menu: going into a folder, showing it in the View instead; its Diff and History; then
 * copying its path, absolute or in its Checkout.
 */
export function rowMenu(
  row: Shown,
  place: Place | undefined,
  openView: OpenView,
  goInto: (path: string) => void,
) {
  const into: RowAction[] = row.folder
    ? [{ id: "into", label: "Go into folder", icon: FolderInput, onAction: () => goInto(row.path) }]
    : [];
  const diff = diffOf(row, place);
  const history = historyOf(row, place);
  const views = [
    ...(diff ? [opening("diff", "Diff", diff, openView)] : []),
    ...(history ? [opening("history", "History", history, openView)] : []),
  ];
  const copies: RowAction[] = [
    {
      id: "absolute",
      label: "Copy absolute path",
      icon: CopySlash,
      onAction: () => void copyText(row.path, row.path),
    },
    ...(place && place.relative !== ""
      ? [
          {
            id: "relative",
            label: "Copy relative path",
            icon: Copy,
            onAction: () => void copyText(place.relative, place.relative),
          },
        ]
      : []),
  ];
  const groups = [into, views, copies].filter((group) => group.length > 0);
  return { label: `Actions on ${row.shown}`, groups };
}

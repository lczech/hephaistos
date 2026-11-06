import { useQueryClient } from "@tanstack/react-query";
import { type Atom, useAtom } from "@tanstack/react-store";
import { type ExpandedState, functionalUpdate } from "@tanstack/react-table";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { filesQuery, KEYS, useFilesOf, useInfo, useRepositories } from "../../api/queries";
import { IconButton } from "../../components/IconButton";
import { useListLayout } from "../../components/list/kept";
import { List } from "../../components/list/List";
import { useList } from "../../components/list/table";
import type { Loaded } from "../../components/list/tree";
import { useKeptSets } from "../../components/list/tree";
import { BarEnd, Refresh, Toggle, ViewBar, ViewPage } from "../../components/ViewBar";
import { FoldersFolded } from "../../drawnIcons";
import { keptAtom } from "../../kept";
import { paramValues } from "../address";
import type { ViewProps } from "../index";
import { sortingOf, withSorting } from "../sorting";
import { useTitle } from "../title";
import { explorerColumns } from "./columns";
import styles from "./ExplorerView.module.css";
import {
  asked,
  DEFAULT_SORT,
  type Entry,
  type FileEntry,
  folders,
  type Making,
  rows,
  SORTS,
} from "./rows";

/** How Explorers show: hidden entries too, or not; for all of them, kept in this browser. */
function explorerLook(): Atom<{ hidden: boolean }> {
  return keptAtom("hephaistos.explorer", (saved) => {
    const { hidden } = (saved as { hidden?: unknown } | null) ?? {};
    return { hidden: typeof hidden === "boolean" ? hidden : true };
  });
}

const OPENED = "opened";
const NONE: ReadonlySet<string> = new Set();

/** A path's parts, each with the path it names: from `~` if under `home`, else from `/`. */
export function pathParts(path: string, home: string | undefined): [string, string][] {
  const inHome =
    home !== undefined && home !== "/" && (path === home || path.startsWith(`${home}/`));
  const [first, start]: [string, string] = inHome ? ["~", home] : ["/", ""];
  const parts: [string, string][] = [[first, start || "/"]];
  let at = start;
  for (const name of path.slice(start.length).split("/").filter(Boolean)) {
    at = `${at}/${name}`;
    parts.push([name, at]);
  }
  return parts;
}

/** The Directory's path in the bar: each part shows that Directory instead. */
function PathBar({
  path,
  home,
  onShow,
}: {
  path: string;
  home?: string;
  onShow: (path: string) => void;
}) {
  const parts = pathParts(path, home);
  // After each part a `/`, but the root's own.
  const after = (index: number) => index > 0 && parts[index - 1]?.[0] !== "/";
  return (
    <span className={styles.path}>
      {parts.map(([name, at], index) => (
        <span key={at}>
          {after(index) && <span className={styles.separator}>/</span>}
          <button type="button" className={styles.part} onClick={() => onShow(at)} title={at}>
            {name}
          </button>
        </span>
      ))}
    </span>
  );
}

/**
 * What a Directory holds (`path`, else the home directory), as a tree: folders first, each
 * opened asked for then, what is opened kept per Directory in this browser. Hidden entries show
 * quieter, in italics, unless left out. Read anew on a hint, on focus, or by reloading.
 */
export function ExplorerView({ params, setParams, fragment, setFragment, setTitle }: ViewProps) {
  const info = useInfo();
  const home = info.data?.home;
  const [given] = paramValues(params.path);
  const root = given ?? home;
  const name = root === undefined ? undefined : (root.split("/").filter(Boolean).at(-1) ?? "/");
  useTitle(setTitle, name && `Explorer: ${name}`);

  const [look, setLook] = useAtom(explorerLook());
  const [sets, setSets] = useKeptSets("explorer", root);
  const opened = sets[OPENED] ?? NONE;
  const setOpened = (next: ReadonlySet<string>) => setSets({ ...sets, [OPENED]: next });
  const sorted = sortingOf(fragment, SORTS, DEFAULT_SORT);

  // The folders asked for: those the rows asked for, once the answers before show them.
  const [wanted, setWanted] = useState<string[]>([]);
  const answers = useFilesOf(wanted.map((path) => ({ path })));
  const known = new Map<string, Loaded<FileEntry>>(
    wanted.map((path, index) => {
      const answer = answers[index];
      if (answer?.data) return [path, { items: answer.data.entries, count: answer.data.count }];
      return [path, answer?.isError ? { error: answer.error.message } : undefined];
    }),
  );
  const making: Making = { loaded: (path) => known.get(path), opened, hidden: look.hidden, sorted };
  const needed = root === undefined ? [] : asked(root, making, making.loaded);
  if (needed.join("\0") !== wanted.join("\0")) setWanted(needed);

  const listed: Entry[] = root === undefined ? [] : rows(root, making);
  const holding = folders(listed);
  const expanded = Object.fromEntries([...holding.keys()].map((id) => [id, opened.has(id)]));

  const repositories = useRepositories();
  const checkouts = new Set(
    (repositories.data ?? []).flatMap((repository) =>
      repository.clones.flatMap((clone) => [
        clone.path,
        clone.resolved_path,
        ...clone.worktrees.map((worktree) => worktree.path),
      ]),
    ),
  );
  const client = useQueryClient();
  const columns = explorerColumns({
    open: (row) => opened.has(row.id),
    checkout: (path) => checkouts.has(path),
    denied: (path) => {
      const loaded = known.get(path);
      return loaded !== undefined && "error" in loaded && loaded.error.startsWith("not allowed");
    },
    ahead: (row) => void client.prefetchQuery(filesQuery({ path: row.path })),
  });
  const [layout] = useListLayout("explorer");
  const table = useList("explorer", layout, {
    columns,
    data: listed,
    getRowId: (entry) => entry.id,
    getSubRows: (entry) => entry.subRows,
    getRowCanExpand: (row) => row.original.type === "entry" && row.original.folder, // closed, empty
    state: { sorting: sorted, expanded },
    manualSorting: true, // the rows come in order, folders first
    onSortingChange: (change) =>
      setFragment(withSorting(fragment, functionalUpdate(change, sorted), DEFAULT_SORT)),
    enableSortingRemoval: false,
    autoResetExpanded: false,
    onExpandedChange: (change) => {
      const next: ExpandedState = functionalUpdate(change, expanded);
      if (next === true) return;
      const changed = new Set(opened);
      for (const id of holding.keys()) {
        if (next[id] === true) changed.add(id);
        else if (expanded[id]) changed.delete(id);
      }
      setOpened(changed);
    },
  });

  const rootLoaded = root === undefined ? undefined : known.get(root);
  let message: string | null = null;
  if (root === undefined) message = info.isError ? "Could not ask for the home directory." : null;
  else if (rootLoaded !== undefined && !("error" in rootLoaded) && listed.length === 0) {
    message = "Empty.";
  }
  return (
    <ViewPage>
      <ViewBar>
        {root !== undefined && (
          <PathBar path={root} home={home} onShow={(path) => setParams({ path })} />
        )}
        <BarEnd>
          <Toggle
            label="Hidden files"
            on={look.hidden}
            onChange={(hidden) => setLook({ hidden })}
            ways={[
              { icon: Eye, title: "Show hidden files and folders, whose names start with a dot" },
              { icon: EyeOff, title: "Leave out hidden files and folders" },
            ]}
          />
          <IconButton
            icon={FoldersFolded}
            label="Close all folders"
            disabled={opened.size === 0}
            onClick={() => setOpened(NONE)}
          />
          <Refresh
            busy={answers.some((answer) => answer.isFetching)}
            onClick={() => void client.invalidateQueries({ queryKey: KEYS.files })}
          />
        </BarEnd>
      </ViewBar>
      <List
        table={table}
        layout={layout}
        oneLine
        tree
        compact
        choices={{}}
        message={message}
        older="files"
        detailsLabel="Details"
        details={() => null}
        folds={(entry) => entry.type === "entry" && entry.folder}
        plain={(entry) => entry.type !== "entry" || !entry.folder}
      />
    </ViewPage>
  );
}

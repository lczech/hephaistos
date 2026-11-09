import { useQueryClient } from "@tanstack/react-query";
import { type Atom, useAtom } from "@tanstack/react-store";
import { type ExpandedState, functionalUpdate } from "@tanstack/react-table";
import { Eye, EyeOff, FileSearch, FileXCorner } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import {
  filesQuery,
  KEYS,
  useFilesOf,
  useInfo,
  usePathsBelow,
  useRepositories,
} from "../../api/queries";
import { FindBar } from "../../components/find/FindBar";
import { useCurrentMatch, useFind } from "../../components/find/useFind";
import { IconButton } from "../../components/IconButton";
import { useListLayout } from "../../components/list/kept";
import { List } from "../../components/list/List";
import { useHidden, useList } from "../../components/list/table";
import type { Loaded } from "../../components/list/tree";
import { useKeptSets } from "../../components/list/tree";
import { BarEnd, BarGroup, Refresh, Toggle, ViewBar, ViewPage } from "../../components/ViewBar";
import { FoldersFolded } from "../../drawnIcons";
import { keptAtom } from "../../kept";
import { useNow } from "../../useNow";
import { paramValues, withParam } from "../address";
import { ChangesLinks } from "../comparison/ChangesLinks";
import { findOf, NOTHING_TYPED, withFind } from "../find";
import type { ViewProps } from "../index";
import { useKeyTarget } from "../keys";
import { useOpenView, useShownViews } from "../opening";
import { sortingOf, withSorting } from "../sorting";
import { useTitle } from "../title";
import { ViewLink } from "../ViewLink";
import { knownCheckouts, placeOf, RowActions, rowMenu, showsFile } from "./actions";
import { COSTLY, explorerColumns, FIELDS } from "./columns";
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
  shownPaths,
} from "./rows";
import {
  bare,
  foldersOf,
  foundPaths,
  inTreeOrder,
  linesOf,
  listedOf,
  searchNote,
  searchOf,
  useSearchLines,
} from "./search";

/** How Explorers show: hidden entries too, or not; for all of them, kept in this browser. */
function explorerLook(): Atom<{ hidden: boolean }> {
  return keptAtom("hephaistos.explorer", (saved) => {
    const { hidden } = (saved as { hidden?: unknown } | null) ?? {};
    return { hidden: typeof hidden === "boolean" ? hidden : true };
  });
}

const OPENED = "opened";
const NONE: ReadonlySet<string> = new Set();
const IGNORED = "ignored"; // in the fragment: a search finds what git ignores too

/**
 * The folders a search folded of those holding its matches, and opened of others, below which
 * Directory, for what it looks for (`pattern`): only while it searches that, apart from those
 * kept; another pattern starts with its folders open.
 */
interface SearchFolds {
  root: string | undefined;
  pattern: string | undefined;
  folded: ReadonlySet<string>;
  opened: ReadonlySet<string>;
}

/**
 * A path as an address may give it, typed by hand, without a final `/` and with its `.` and `..`
 * resolved: `/a/b/` is `/a/b`, `/a/b/../c` is `/a/c`; so that a root holds what it seems to.
 */
export function bareDir(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  if (!path.startsWith("/")) return path.replace(/\/+$/, ""); // not a path the Server lists
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "" && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/** Whether `path` is `folder` or below it. */
export function within(path: string, folder: string): boolean {
  return folder === "/" || path === folder || path.startsWith(`${folder}/`);
}

/**
 * A path's parts, each with the path it names: from `limit`, by its name, if given; else from
 * `~` if under `home`, else from `/`.
 */
export function pathParts(
  path: string,
  home: string | undefined,
  limit?: string,
): [string, string][] {
  const inHome = home !== undefined && home !== "/" && within(path, home);
  const [first, start]: [string, string] =
    limit !== undefined && limit !== "/"
      ? [limit.split("/").at(-1) ?? limit, limit]
      : inHome
        ? ["~", home]
        : ["/", ""];
  const parts: [string, string][] = [[first, start || "/"]];
  let at = start;
  for (const name of path.slice(start.length).split("/").filter(Boolean)) {
    at = `${at}/${name}`;
    parts.push([name, at]);
  }
  return parts;
}

/** The Directory's path in the bar, from `limit` if given: each part shows that Directory instead. */
function PathBar({
  path,
  home,
  limit,
  onShow,
}: {
  path: string;
  home?: string;
  limit?: string;
  onShow: (path: string) => void;
}) {
  const parts = pathParts(path, home, limit);
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
 * What a Directory holds (`path`, else `root`, else the home directory), never above `root`, as a
 * tree: folders first, each
 * opened asked for then, what is opened kept per Directory in this browser. Hidden entries show
 * quieter, in italics, unless left out. Read anew on a hint, on focus, or by reloading.
 * Its find row finds files and folders below it by name (`search.ts`): the tree shows only them,
 * in the folders holding them, opened for the search; closed, it reveals the match stepped to.
 */
export function ExplorerView({
  params,
  setParams,
  fragment,
  setFragment,
  endTyping,
  setTitle,
}: ViewProps) {
  const info = useInfo();
  const home = info.data?.home;
  const given = bareDir(paramValues(params.path)[0]);
  const limit = bareDir(paramValues(params.root)[0]); // shown in the View, not kept from the Server
  const requested = given ?? limit ?? home;
  const root =
    limit !== undefined && requested !== undefined && !within(requested, limit) ? limit : requested;
  const showIn = (path: string) => setParams({ ...params, path });
  const name = root === undefined ? undefined : (root.split("/").filter(Boolean).at(-1) ?? "/");
  useTitle(setTitle, name && `Explorer: ${name}`);

  const [look, setLook] = useAtom(explorerLook());
  const [sets, setSets] = useKeptSets("explorer", root);
  const kept = sets[OPENED] ?? NONE;
  const setKept = (next: ReadonlySet<string>) => setSets({ ...sets, [OPENED]: next });
  const sorted = sortingOf(fragment, SORTS, DEFAULT_SORT);

  // Finding by name: every path below, listed once, matched as typed off the page.
  const finding = findOf(fragment);
  const ignoredToo = fragment[IGNORED] !== undefined;
  const findKey = useKeyTarget(finding ? undefined : "search"); // the field's, once open
  const findButton = useRef<HTMLButtonElement>(null); // focused again once the row closes
  const byPath = finding?.text.includes("/") ?? false;
  const listing = usePathsBelow(
    finding && root !== undefined
      ? { path: root, hidden: look.hidden, ignored: ignoredToo }
      : undefined,
  );
  const lines = useSearchLines(root, listing.data?.paths, byPath);
  // Its limit counts paths, as the tree shows paths, not matches.
  const searched = useFind(lines, finding?.text ? finding : undefined, "line");
  const matches = searched && "matches" in searched ? searched.matches : undefined;
  // While it finds again, what it found before, in the paths it found it in, if below the root.
  const searchedIn = searched && "in" in searched ? linesOf(searched.in) : undefined;
  const found =
    searched && "matches" in searched && searchedIn && searchedIn.root === root
      ? foundPaths(searchedIn.paths, searched.matches, {
          more: searched.more,
          byPath: searchedIn.byPath,
        })
      : undefined;
  const search = found && searchOf(found.paths);
  // What is looked for, as matched: typing anew is another search.
  const pattern =
    finding && [finding.text, finding.matchCase, finding.wholeWord, finding.regex].join("\0");
  const fresh: SearchFolds = { root, pattern, folded: NONE, opened: NONE };
  const [folds, setFolds] = useState<SearchFolds>(fresh);
  const own = folds.root === root && folds.pattern === pattern ? folds : fresh;
  const opened = search
    ? new Set([...[...search.folders].filter((id) => !own.folded.has(id)), ...own.opened])
    : kept;
  const setOpened = (next: ReadonlySet<string>) => {
    if (!search) return setKept(next);
    const folded = [...search.folders].filter((id) => !next.has(id));
    setFolds({ ...fresh, folded: new Set(folded), opened: new Set(next) });
  };
  const listedFound = search && root !== undefined && listedOf(root, found.paths, search.folders);

  // What each folder holds is asked for twice: names and kinds, which come at once, to show;
  // then git's letters and what the shown columns need, which cost more, to fill in.
  const [layout] = useListLayout("explorer");
  const hiddenColumns = useHidden("explorer", layout, COSTLY, { sorting: sorted });
  const fields = FIELDS.filter((field) => field === "git" || !hiddenColumns.has(field));

  // The folders asked for: those the rows asked for, once the answers before show them.
  const [wanted, setWanted] = useState<string[]>([]);
  const answers = useFilesOf(wanted.map((path) => ({ path })));
  const details = useFilesOf(wanted.map((path) => ({ path, fields })));
  const loaded = new Map<string, Loaded<FileEntry>>(
    wanted.map((path, index) => {
      const answer = details[index]?.data ?? answers[index]?.data;
      if (answer) return [path, { items: answer.entries, count: answer.count }];
      const failed = answers[index]?.error;
      return [path, failed ? { error: failed.message } : undefined];
    }),
  );
  const denied = new Set(
    wanted.filter((_, index) => {
      const failed = answers[index]?.error;
      return failed instanceof ApiError && failed.status === 403;
    }),
  );
  const making: Making = {
    loaded: (path) => loaded.get(path) ?? (listedFound ? listedFound.get(path) : undefined),
    opened,
    hidden: look.hidden,
    sorted,
    search,
  };
  const needed = root === undefined ? [] : asked(root, making, making.loaded);
  if (needed.join("\0") !== wanted.join("\0")) setWanted(needed);

  const listed: Entry[] = root === undefined ? [] : rows(root, making);
  const holding = folders(listed);
  const expanded = Object.fromEntries([...holding.keys()].map((id) => [id, opened.has(id)]));

  // Stepping through the matches, in the tree's order, opens the folders holding the one stepped
  // to and scrolls to it; closing the find row reveals it among the folders kept open.
  const order =
    search && found && root !== undefined
      ? inTreeOrder(
          rows(root, { ...making, opened: search.folders }),
          new Set(found.paths.map(bare)),
        )
      : [];
  const [current, step] = useCurrentMatch(matches, order.length);
  const currentPath = search ? order[current] : undefined;
  // The match revealed, below the root it was found in: another's paths are others.
  const [revealed, setRevealed] = useState<{ root: string | undefined; path: string }>();
  const shownCurrent = finding ? currentPath : revealed?.root === root ? revealed?.path : undefined;
  const view = useRef<HTMLElement>(null);
  const scrolled = useRef<string | undefined>(undefined); // the root and path scrolled to
  useEffect(() => {
    const at = `${root}\0${shownCurrent}`;
    if (shownCurrent === undefined || scrolled.current === at) return;
    const row = view.current?.querySelector("[data-current]");
    if (!row) return; // not yet shown, e.g. its folder still asked for
    row.scrollIntoView({ block: "nearest" });
    scrolled.current = at;
  });
  const stepTo = (by: 1 | -1) => {
    const next = order[(current + by + order.length) % order.length];
    if (next === undefined) return;
    const holders = new Set(foldersOf(next));
    setFolds({ ...own, folded: new Set([...own.folded].filter((id) => !holders.has(id))) });
    scrolled.current = undefined;
    step(by);
  };
  const setFinding = (next: typeof finding, typed = false) =>
    setFragment(withFind(fragment, next), typed);
  const openFind = () => {
    setRevealed(undefined);
    setFinding(NOTHING_TYPED);
  };
  const closeFind = () => {
    if (currentPath !== undefined) {
      setKept(new Set([...kept, ...foldersOf(currentPath)]));
      setRevealed({ root, path: currentPath });
      scrolled.current = undefined;
    }
    setFolds(fresh);
    setFragment(withParam(withFind(fragment, undefined), IGNORED, []));
    findButton.current?.focus();
  };

  const repositories = useRepositories();
  const known = knownCheckouts(repositories.data ?? []);
  const checkouts = new Set(known.flatMap(({ paths }) => paths));
  // The working tree each folder lies in, as git found it with its letters.
  const tops = new Map(wanted.map((path, index) => [path, details[index]?.data?.top ?? undefined]));
  const placeOfRow = (row: Extract<Entry, { type: "entry" }>) =>
    placeOf(row, tops.get(row.parent), known);
  // The Checkout the shown folder lies in, by the working tree git found it in, if registered.
  const shownTop = root === undefined ? undefined : tops.get(root);
  const shownIn =
    shownTop === undefined ? undefined : known.find(({ paths }) => paths.includes(shownTop));
  const checkoutName = shownIn?.paths[0]?.split("/").at(-1) ?? "";
  const openView = useOpenView();
  const shownViews = useShownViews();
  const client = useQueryClient();
  const columns = explorerColumns({
    open: (row) => opened.has(row.id),
    marked: (row) => {
      const marks = search && found?.marks.get(bare(row.id));
      return marks ? { marks, current: bare(row.id) === currentPath } : undefined;
    },
    current: (row) => shownCurrent !== undefined && shownPaths(row).includes(shownCurrent),
    checkout: (path) => checkouts.has(path),
    denied: (path) => denied.has(path),
  });
  const now = useNow(10_000);
  const table = useList("explorer", layout, {
    columns,
    meta: { now },
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

  const rootLoaded = root === undefined ? undefined : loaded.get(root);
  let message: string | null = null;
  let problem = false;
  if (root === undefined) {
    message = info.isError ? "Could not ask for the home directory." : null;
    problem = info.isError;
  } else if (finding && listing.error) {
    message = `Could not find: ${listing.error.message}`;
    problem = true;
  } else if (search && listed.length === 0) message = "No files or folders found.";
  else if (rootLoaded !== undefined && !("error" in rootLoaded) && listed.length === 0) {
    message = "Empty.";
  }
  return (
    <ViewPage ref={view}>
      <ViewBar>
        {/* Once the home directory is known, so that the path does not change from /home/me to ~. */}
        {root !== undefined && !info.isPending && (
          <PathBar path={root} home={home} limit={limit} onShow={showIn} />
        )}
        <BarEnd>
          <BarGroup>
            <Toggle
              ref={(button) => {
                findButton.current = button;
                return findKey(button);
              }}
              label="Find files and folders by name"
              on={finding !== undefined}
              onChange={(on) => (on ? openFind() : closeFind())}
              ways={[{ icon: FileSearch, title: "Find files and folders by name (Ctrl+F)" }]}
            />
            <Toggle
              label="Hidden files"
              on={look.hidden}
              onChange={(hidden) => setLook({ hidden })}
              ways={[
                { icon: Eye, title: "Show hidden files and folders, whose names start with a dot" },
                { icon: EyeOff, title: "Leave out hidden files and folders" },
              ]}
            />
          </BarGroup>
          <BarGroup>
            <IconButton
              icon={FoldersFolded}
              label="Close all folders"
              disabled={opened.size === 0}
              onClick={() => setOpened(NONE)}
            />
            <Refresh
              busy={[...answers, ...details].some((answer) => answer.isFetching)}
              onClick={() => {
                void client.invalidateQueries({ queryKey: KEYS.files });
                void client.invalidateQueries({ queryKey: KEYS.paths });
              }}
            />
          </BarGroup>
          <BarGroup>
            {shownIn && (
              <>
                <ViewLink
                  address={{ kind: "history", params: shownIn.checkout }}
                  label={`Commit history of ${checkoutName}`}
                />
                <ChangesLinks checkout={shownIn.checkout} what={`changes in ${checkoutName}`} />
              </>
            )}
          </BarGroup>
        </BarEnd>
      </ViewBar>
      {finding && (
        <FindBar
          label="Find files and folders by name"
          query={finding}
          onChange={setFinding}
          onTypingEnd={endTyping}
          finding={searched}
          count={order.length}
          current={current}
          onStep={stepTo}
          onClose={closeFind}
          busy={listing.isFetching}
          note={searchNote(found, listing.data)}
          more={
            <Toggle
              label="Include git-ignored files and folders"
              on={ignoredToo}
              onChange={(on) => setFragment(withParam(fragment, IGNORED, on ? ["1"] : []))}
              ways={[{ icon: FileXCorner, title: "Include git-ignored files and folders" }]}
            />
          }
        />
      )}
      <List
        table={table}
        layout={layout}
        oneLine
        tree
        compact
        choices={{}}
        message={message}
        problem={problem}
        older="files"
        detailsLabel="Details"
        details={() => null}
        folds={(entry) => entry.type === "entry" && entry.folder}
        plain={(entry) => entry.type !== "entry" || !entry.folder}
        showing={(entry) => {
          if (entry.type !== "entry" || entry.folder) return false;
          const place = placeOfRow(entry);
          return shownViews.some((shown) => showsFile(shown, place));
        }}
        actions={(entry) =>
          entry.type === "entry" ? <RowActions row={entry} place={placeOfRow(entry)} /> : null
        }
        menu={(entry) =>
          entry.type === "entry" ? rowMenu(entry, placeOfRow(entry), openView, showIn) : undefined
        }
        ahead={(entry) => {
          // A closed folder pointed at or focused: what it holds shows at once once opened.
          if (entry.type !== "entry" || !entry.folder || opened.has(entry.id)) return;
          void client.prefetchQuery(filesQuery({ path: entry.path }));
          void client.prefetchQuery(filesQuery({ path: entry.path, fields }));
        }}
      />
    </ViewPage>
  );
}

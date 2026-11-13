import { ChevronDown, FolderPen, ListChecks, type LucideIcon } from "lucide-react";
import {
  Fragment,
  type Key,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Autocomplete,
  Button,
  Dialog,
  DialogTrigger,
  Header,
  ListBox,
  ListBoxItem,
  ListBoxLoadMoreItem,
  ListBoxSection,
  ListLayout,
  Popover,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Virtualizer,
} from "react-aria-components";
import type { Schemas } from "../api/client";
import { type HistoryQuery, resolveRevision, useHistory } from "../api/queries";
import { COMMIT_ICON, HEAD_ICON, REF_ICONS } from "../icons";
import { HEAD, headText, INDEX, revisionText, shortHash, WORKING_TREE } from "../revisions";
import { atLeast, numberText, searchWords } from "../text";
import { useDebounced } from "../useDebounced";
import { loadErrorText } from "../views/CheckoutError";
import type { Checkout } from "../views/checkout";
import styles from "./GitRevisionPicker.module.css";
import popover from "./popover.module.css";
import { SearchField } from "./SearchField";
import { TextIcon } from "./TextIcon";

type Ref = Schemas["RefJson"];
type Commit = Schemas["CommitJson"];
/** What a Checkout's history says of its refs: where HEAD is, and its branches and tags. */
export type KnownRefs = Pick<Schemas["HistoryJson"], "head" | "branch" | "refs">;

export type FixedRow = typeof WORKING_TREE | typeof INDEX | typeof HEAD;
export type PickerTab = "branches" | "tags" | "commits";
/** A tab shown: all kinds, each a few, or one kind, all of it. */
type Shown = "all" | PickerTab;

const SEARCH_DELAY = 300; // ms after the last key typed, for commits
const TAB_NAMES: Record<Shown, string> = {
  all: "All",
  branches: "Branches",
  tags: "Tags",
  commits: "Commits",
};
const REF_TABS: Record<Ref["kind"], PickerTab> = {
  branch: "branches",
  remote: "branches",
  tag: "tags",
};
// How many of each kind All shows, before a row leading to their tab.
const ALL_SHOWS = { refs: 5, commits: 10 };
const MORE = "more:"; // a row leading to a tab, `more:<tab>:<section>`: an ID no Revision has
const SHORT_HASH = /^[0-9a-f]{4,40}$/i;

/** Whose commits are offered: those of HEAD, of every branch and tag, or of the walk of a graph,
 * in its order, as it lists them. */
export type CommitsFrom = "head" | "everywhere" | Pick<HistoryQuery, "branches" | "hide" | "order">;

/** A Revision picked: as named to git, the commit it is at where known, and as shown. */
export interface Picked {
  revision: string; // `HEAD`, `index`, `working-tree`, a full ref name or the hash of a commit
  commit: string | undefined; // undefined for a fixed row
  name: string; // `main`, `abc1234`, `HEAD (main)`, or what was typed
}

interface ListProps {
  checkout: Checkout;
  label: string;
  /** The Revision picked, marked, its tab shown first; none for a picker that only goes to one. */
  value?: string;
  /** The Revisions offered first in each tab, in this order. */
  rows: FixedRow[];
  /** The kinds offered, each in a tab after All. */
  tabs: PickerTab[];
  commitsFrom: CommitsFrom;
  /** Whether remote-tracking branches are offered with the branches; by default they are. */
  withRemotes?: boolean;
  /** The refs as known already, until those of the list come. */
  known?: KnownRefs;
  onPick: (picked: Picked) => void;
}

interface GitRevisionPickerProps extends Omit<ListProps, "value" | "onPick"> {
  title?: string;
  className?: string;
  /** A Revision: `HEAD`, `index`, `working-tree`, a full ref name or the hash of a commit. */
  value: string;
  onChange: (revision: string) => void;
}

/** A button showing a Revision, named by the refs known (`known`), opening a list to pick
 * another from (`RevisionList`). */
export function GitRevisionPicker({
  title,
  className,
  value,
  onChange,
  ...list
}: GitRevisionPickerProps) {
  const [open, setOpen] = useState(false);
  const { label, known } = list;
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button
        className={[styles.trigger, className].filter(Boolean).join(" ")}
        aria-label={`${label}: ${pickedText(value, known)}`}
      >
        <PickedIcon value={value} refs={known} />
        <span className={styles.picked} title={title}>
          {pickedText(value, known)}
        </span>
        <ChevronDown className={styles.chevron} aria-hidden="true" />
      </Button>
      <RevisionPopover
        {...list}
        value={value}
        onPick={(picked) => {
          onChange(picked.revision);
          setOpen(false);
        }}
      />
    </DialogTrigger>
  );
}

/** The popover of a picker of Revisions, its list made only once it opens (`RevisionList`). */
export function RevisionPopover(props: ListProps) {
  return (
    <Popover className={`${popover.popover} ${styles.popover}`} placement="bottom start">
      <RevisionList {...props} />
    </Popover>
  );
}

/**
 * The list a picker of Revisions opens, in its popover, to pick one from: some fixed first, then
 * branches, tags or commits, a few of each in All, all of one kind in its tab. Typing filters
 * them, best matches first, and shows All: an exact name or a hash's commit on top; branches
 * and tags filtered here, commits by searching their messages and hashes. Enter on no match
 * resolves what is typed as git does: `HEAD~3`, `v1.0^`. Ctrl+←/→ switch tabs. Made anew each
 * time it opens, so it starts with nothing typed, on the tab of the Revision picked.
 */
function RevisionList({
  checkout,
  label,
  value,
  rows,
  tabs,
  commitsFrom,
  withRemotes = true,
  known,
  onPick,
}: ListProps) {
  const [typed, setTyped] = useState("");
  const [chosen, setChosen] = useState<Shown | null>(null); // until then, the value's tab
  const [browsed, setBrowsed] = useState<Shown | null>(null); // before typing, to go back to
  const [lists, setLists] = useState(0); // a new list each time a tab is chosen
  const [error, setError] = useState<string | null>(null);
  // Whether the list is still open: what git resolves after it closed, e.g. by Escape, is not
  // picked.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const [searched, searchNow] = useDebounced(typed, SEARCH_DELAY);
  const searching = tabs.includes("commits"); // else the history only for its refs
  const words = searching ? searchWords(searched) : [];
  let from: Pick<HistoryQuery, "everywhere" | "branches" | "hide" | "order"> = {};
  if (commitsFrom === "everywhere") from = { everywhere: true };
  else if (commitsFrom !== "head") from = commitsFrom;
  const query: HistoryQuery = {
    ...checkout,
    ...from,
    ...(words.length === 0 ? {} : { search: words.join(" ") }),
  };
  const history = useHistory(query);
  const first = history.data?.pages[0];
  const refs = first ?? known;
  const shownTabs: Shown[] = ["all", ...tabs];
  const tab = chosen ?? (value === undefined ? undefined : tabOf(value, refs, tabs)) ?? "all";

  const text = typed.trim();
  const typedWords = searchWords(typed);
  // Commits of an earlier search, until this one's come: shown, but not to pick.
  const stale =
    searching && (typedWords.join(" ") !== words.join(" ") || history.isPlaceholderData);
  const fixed = rows
    .filter((row) => matchRank(`${FIXED_WORDS[row]} ${row}`, text) !== undefined) // HEAD not by its branch
    .map((row) => ({ id: row, text: fixedText(row, refs) }));
  const matched = (kind: Ref["kind"]) =>
    tabs.includes(REF_TABS[kind])
      ? ranked(refs?.refs.filter((ref) => ref.kind === kind) ?? [], (ref) => ref.name, text)
      : [];
  const branches = matched("branch");
  const remotes = withRemotes ? matched("remote") : [];
  const tags = matched("tag");
  const commits = searching
    ? foundFirst(first?.found?.commit, history.data?.pages.flatMap((page) => page.commits) ?? [])
    : [];
  // An exact name, else the commit of a hash, first in All.
  const exact =
    text === ""
      ? undefined
      : [...branches, ...remotes, ...tags].find((ref) => matchRank(ref.name, text) === 0);
  const found = searching && !stale && first?.found ? first.found.commit : undefined;
  const top: Top | undefined = exact ? { ref: exact } : found && { commit: found };
  const counts: Record<Shown, string> = {
    all: "",
    branches: numberText(branches.length + remotes.length),
    tags: numberText(tags.length),
    commits:
      history.data === undefined || stale ? "…" : atLeast(commits.length, history.hasNextPage),
  };

  // A Revision picked, with its commit and name where the list knows them.
  const pick = (revision: string, typedName?: string) => {
    const ref = refs?.refs.find((each) => each.full === revision);
    let picked: Picked;
    if (ref) picked = { revision, commit: ref.commit, name: ref.name };
    else if (rows.includes(revision as FixedRow)) {
      picked = { revision, commit: undefined, name: fixedText(revision as FixedRow, refs) };
    } else {
      picked = {
        revision,
        commit: revision,
        name: typedName ?? shortHash(revision),
      };
    }
    onPick(picked);
  };
  // A tab chosen gets a new list, top first, nothing focused: the list kept would focus the row
  // where the one focused was, e.g. a commit where `… more commits` was.
  const browse = (next: Shown | null) => {
    setChosen(next);
    setLists((count) => count + 1);
  };
  const act = (key: Key) => {
    const id = String(key);
    if (id.startsWith(MORE)) browse(id.slice(MORE.length).split(":")[0] as PickerTab);
    else pick(id);
  };
  // Typing shows All; clearing, the tab browsed before.
  const typedChanged = (next: string) => {
    const was = text !== "";
    const is = next.trim() !== "";
    if (!was && is) {
      setBrowsed(tab);
      setChosen("all");
    } else if (was && !is) browse(browsed);
    setTyped(next);
    setError(null);
  };
  // The rows to pick, in the order the tab shows them: Enter's, if Autocomplete focuses none.
  const pickable = (): string[] => {
    const fixedIds = fixed.map((row) => row.id);
    const fulls = (shown: Ref[]) => shown.map((ref) => ref.full);
    const hashes = stale ? [] : commits.map((commit) => commit.hash);
    const topId = top?.ref?.full ?? top?.commit?.hash;
    if (tab === "branches") return [...fixedIds, ...fulls(branches), ...fulls(remotes)];
    if (tab === "tags") return [...fixedIds, ...fulls(tags)];
    if (tab === "commits") return [...fixedIds, ...hashes];
    const all = [...fulls(branches), ...fulls(remotes), ...fulls(tags), ...hashes];
    return [...(topId ? [topId] : []), ...fixedIds, ...all];
  };
  // Enter picks the row Autocomplete focuses, else the first; with none, an earlier search's
  // commits wait for this one's, and with none still, git resolves what is typed.
  const submit = () => {
    if (text === "") return;
    if (document.activeElement?.getAttribute("aria-activedescendant")) return; // picked
    const [firstRow] = pickable();
    if (firstRow !== undefined) pick(firstRow);
    else if (stale) searchNow();
    else {
      resolveRevision(checkout, text).then(
        (commit) => open.current && pick(commit, text),
        (failed: Error) => setError(failed.message),
      );
    }
  };
  const switchTab = (event: KeyboardEvent) => {
    if (!event.ctrlKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const at = shownTabs.indexOf(tab) + (event.key === "ArrowLeft" ? -1 : 1);
    browse(shownTabs[(at + shownTabs.length) % shownTabs.length] ?? tab);
  };

  const refRow = (ref: Ref) => (
    <Row key={ref.full} id={ref.full} value={value} icon={REF_ICONS[ref.kind]} text={ref.name} />
  );
  const commitRow = (commit: Commit) => (
    <Row
      key={commit.hash}
      id={commit.hash}
      value={value}
      icon={COMMIT_ICON}
      text={commit.subject}
      hash={shortHash(commit.hash)}
      disabled={stale}
    />
  );
  // The fixed rows, with a line above them (in All, below the top match) or below them (in a
  // kind's tab, above its rows).
  const fixedRows = (line: "above" | "below" | null) =>
    fixed.length > 0 && (
      <ListBoxSection id="fixed">
        {fixed.map((row, at) => (
          <Row
            key={row.id}
            id={row.id}
            value={value}
            icon={FIXED_ICONS[row.id]}
            text={row.text}
            line={
              (line === "above" && at === 0) || (line === "below" && at === fixed.length - 1)
                ? line
                : undefined
            }
          />
        ))}
      </ListBoxSection>
    );
  // Rows under a heading; with a line above it, when it follows others.
  const section = (id: string, heading: string | null, shown: ReactNode[], lined = false) =>
    shown.length > 0 && (
      <ListBoxSection id={id}>
        {heading !== null && (
          <Header className={styles.header} data-lined={lined || undefined}>
            {heading}
          </Header>
        )}
        {shown}
      </ListBoxSection>
    );
  // A few of a kind, then a row leading to their tab, saying how many more.
  const few = <T,>(
    id: string,
    heading: string,
    all: T[],
    row: (item: T) => ReactNode,
    lined: boolean,
  ) => {
    const limit = id === "commits" ? ALL_SHOWS.commits : ALL_SHOWS.refs;
    const others = all.filter((item) => item !== top?.ref && item !== top?.commit);
    const rest = others.length - limit;
    const unknown = id === "commits" && history.hasNextPage; // pages still to load
    const more = REF_TABS[id as Ref["kind"]] ?? "commits";
    const what = heading.toLowerCase();
    const moreText = unknown ? `… more ${what}` : `… ${numberText(rest)} more ${what}`;
    const moreId = `${MORE}${more}:${id}`;
    return section(
      id,
      heading,
      [
        ...others.slice(0, limit).map(row),
        ...(rest > 0 || unknown
          ? [
              <ListBoxItem
                key={moreId}
                id={moreId}
                className={styles.row}
                textValue={moreText}
                isDisabled={id === "commits" && stale}
              >
                <span className={styles.moreText}>{moreText}</span>
              </ListBoxItem>,
            ]
          : []),
      ],
      lined,
    );
  };
  const loadMore = history.hasNextPage && (
    <ListBoxLoadMoreItem
      className={styles.more}
      isLoading={history.isFetchingNextPage}
      onLoadMore={() => {
        if (!history.isFetching) void history.fetchNextPage();
      }}
    >
      Loading older commits…
    </ListBoxLoadMoreItem>
  );
  // All's groups, a line between each and the one before.
  const allGroups = () => {
    let above = false;
    const shown = (group: ReactNode) => {
      if (group) above = true;
      return group;
    };
    return (
      <>
        {shown(
          top && section("top", "Top match", [top.ref ? refRow(top.ref) : commitRow(top.commit)]),
        )}
        {shown(fixedRows(above ? "above" : null))}
        {tabs.includes("branches") && shown(few("branch", "Branches", branches, refRow, above))}
        {tabs.includes("branches") &&
          shown(few("remote", "Remote branches", remotes, refRow, above))}
        {tabs.includes("tags") && shown(few("tag", "Tags", tags, refRow, above))}
        {tabs.includes("commits") && shown(few("commits", "Commits", commits, commitRow, above))}
      </>
    );
  };
  const panels: Record<Shown, () => ReactNode> = {
    all: allGroups,
    branches: () => (
      <>
        {fixedRows("below")}
        {section("local", remotes.length > 0 ? "Local" : null, branches.map(refRow))}
        {section("remote", "Remote", remotes.map(refRow))}
      </>
    ),
    tags: () => (
      <>
        {fixedRows("below")}
        {tags.map(refRow)}
      </>
    ),
    commits: () => (
      <>
        {fixedRows("below")}
        {commits.map(commitRow)}
        {loadMore}
      </>
    ),
  };
  const failed = (shown: Shown) => shown === "commits" && history.isError;
  const empty = (shown: Shown) => {
    if (failed(shown) && history.error) return loadErrorText(history.error);
    if (shown !== "tags" && shown !== "branches" && history.data === undefined) return "Loading…";
    if (shown === "all") return text === "" ? "Nothing to pick." : "Nothing matches.";
    const what = TAB_NAMES[shown].toLowerCase();
    return text === "" ? `No ${what}.` : `No ${what} match.`;
  };

  return (
    <Dialog className={styles.dialog} aria-label={label}>
      <Autocomplete inputValue={typed} onInputChange={typedChanged}>
        <SearchField
          className={styles.search}
          label={`Search ${label.toLowerCase()}`}
          placeholder={tabs.includes("commits") ? "Name, hash or message" : "Name"}
          value={typed}
          onChange={typedChanged}
          onSubmit={submit}
          onKeyDown={switchTab}
          autoFocus
        />
        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Tabs
          className={styles.tabs}
          selectedKey={tab}
          onSelectionChange={(key) => {
            if (key !== tab) browse(key as Shown);
          }}
        >
          <TabList className={styles.tabList} aria-label="Kinds">
            {shownTabs.map((shown) => (
              <Tab key={shown} id={shown} className={styles.tab}>
                {TAB_NAMES[shown]} <span className={styles.count}>{counts[shown]}</span>
              </Tab>
            ))}
          </TabList>
          {/* One panel, its list kept as typing shows All: Autocomplete then goes on focusing
              the first row as typed, which a list swapped for another would lose. */}
          <TabPanel id={tab} className={styles.panel}>
            <Virtualizer
              key={lists}
              layout={ListLayout}
              layoutOptions={{ estimatedRowSize: 26, estimatedHeadingSize: 22 }}
            >
              <ListBox
                className={styles.list}
                aria-label={TAB_NAMES[tab]}
                onAction={act}
                renderEmptyState={() => (
                  <p className={failed(tab) ? styles.failed : styles.empty}>{empty(tab)}</p>
                )}
              >
                <Fragment key={tab}>{panels[tab]()}</Fragment>
              </ListBox>
            </Virtualizer>
          </TabPanel>
        </Tabs>
      </Autocomplete>
    </Dialog>
  );
}

/** What All shows first: a ref named exactly as typed, or the commit of a hash typed. */
type Top = { ref: Ref; commit?: undefined } | { ref?: undefined; commit: Commit };

/**
 * How well a name matches what is typed, best first: 0 the same, 1 starting with it, 2 with
 * it at a word's start (after `/`, `-`, `.`, `_`), 3 anywhere, 4 its words apart; in any case.
 * Undefined if it lacks a word; 0 for anything when nothing is typed.
 */
export function matchRank(name: string, typed: string): number | undefined {
  const words = searchWords(typed.toLowerCase());
  const lower = name.toLowerCase();
  if (!words.every((word) => lower.includes(word))) return undefined;
  const whole = words.join(" ");
  if (whole === "" || lower === whole) return 0;
  if (lower.startsWith(whole)) return 1;
  for (let at = lower.indexOf(whole); at > 0; at = lower.indexOf(whole, at + 1)) {
    if ("/-._ ".includes(lower[at - 1] ?? "")) return 2;
  }
  return lower.includes(whole) ? 3 : 4;
}

/** The items whose name matches what is typed, best first, else in their order. */
function ranked<T>(items: T[], name: (item: T) => string, typed: string): T[] {
  return items
    .map((item) => ({ item, rank: matchRank(name(item), typed) }))
    .filter((found): found is { item: T; rank: number } => found.rank !== undefined)
    .sort((a, b) => a.rank - b.rank) // stable: ties keep git's order, newest first
    .map(({ item }) => item);
}

const FIXED_ICONS: Record<FixedRow, LucideIcon> = {
  [WORKING_TREE]: FolderPen,
  [INDEX]: ListChecks,
  [HEAD]: HEAD_ICON,
};

const FIXED_WORDS: Record<FixedRow, string> = {
  [WORKING_TREE]: "Working tree",
  [INDEX]: "Staged (index)",
  [HEAD]: "HEAD",
};

/** A fixed row's words: `Working tree`, `Staged (index)`, `HEAD (main)`. */
function fixedText(row: FixedRow, refs: KnownRefs | undefined): string {
  return row === HEAD ? headText(refs?.head, refs?.branch) : FIXED_WORDS[row];
}

/** A Revision as the button shows it: a fixed row's words, a ref's short name, a short hash. */
export function pickedText(value: string, refs: KnownRefs | undefined): string {
  if (value === WORKING_TREE || value === INDEX || value === HEAD) return fixedText(value, refs);
  return revisionText(value);
}

/** Which tab lists a Revision; undefined for a fixed row, or a tab not offered. */
export function tabOf(
  value: string,
  refs: KnownRefs | undefined,
  tabs: PickerTab[],
): PickerTab | undefined {
  const ref = refs?.refs.find((known) => known.full === value || known.name === value);
  let found: PickerTab | undefined;
  if (ref !== undefined) found = REF_TABS[ref.kind];
  else if (SHORT_HASH.test(value)) found = "commits";
  return found !== undefined && tabs.includes(found) ? found : undefined;
}

/** The commits searched for, a hash's commit first, each once. */
function foundFirst(found: Commit | undefined, commits: Commit[]): Commit[] {
  const seen = new Set<string>();
  return [...(found ? [found] : []), ...commits].filter((commit) => {
    if (seen.has(commit.hash)) return false; // pages may overlap while new commits come
    seen.add(commit.hash);
    return true;
  });
}

function PickedIcon({ value, refs }: { value: string; refs: KnownRefs | undefined }) {
  let Icon: LucideIcon = REF_ICONS.branch;
  if (value === WORKING_TREE || value === INDEX || value === HEAD) Icon = FIXED_ICONS[value];
  else {
    const ref = refs?.refs.find((known) => known.full === value || known.name === value);
    if (ref !== undefined) Icon = REF_ICONS[ref.kind];
    else if (value.startsWith("refs/tags/")) Icon = REF_ICONS.tag;
    else if (value.startsWith("refs/remotes/")) Icon = REF_ICONS.remote;
    else if (SHORT_HASH.test(value)) Icon = COMMIT_ICON;
  }
  return <TextIcon icon={Icon} className={styles.icon} />;
}

interface RowProps {
  id: string;
  value: string | undefined; // the Revision picked, marked
  icon: LucideIcon;
  text: string;
  hash?: string;
  disabled?: boolean;
  line?: "above" | "below"; // setting it apart from the rows there
}

/** A Revision to pick: its icon, a commit's short hash, and its name or subject. */
function Row({ id, value, icon: Icon, text, hash, disabled, line }: RowProps) {
  return (
    <ListBoxItem
      id={id}
      isDisabled={disabled}
      className={styles.row}
      textValue={hash === undefined ? text : `${hash} ${text}`}
      data-current={id === value || undefined}
      data-line={line}
    >
      <TextIcon icon={Icon} className={styles.icon} />
      {hash !== undefined && <span className={styles.hash}>{hash}</span>}
      <span className={styles.text}>{text}</span>
    </ListBoxItem>
  );
}

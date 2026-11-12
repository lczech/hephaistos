import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Schemas } from "../../api/client";
import { type HistoryQuery, KEYS, useGraph, useHistory, useRepositories } from "../../api/queries";
import { useListLayout } from "../../components/list/kept";
import { LayoutToggle } from "../../components/list/LayoutToggle";
import { BarEnd, BarGroup, Refresh, ViewBar, ViewPage } from "../../components/ViewBar";
import { hueColour, hueOf } from "../../hues";
import { pathParts } from "../../paths";
import { numberText } from "../../text";
import { useNow } from "../../useNow";
import { type Params, paramValues, withParam } from "../address";
import { Gone, isGone, LoadNote, useKeptError } from "../CheckoutError";
import { type Checkout, checkoutName, checkoutOf, checkoutState } from "../checkout";
import { CommitList } from "../commits/CommitList";
import { OrderToggle, orderOf, withOrder } from "../commits/OrderToggle";
import { type CheckedOut, type Entry, entries, uncommittedIn } from "../commits/rows";
import type { ViewProps } from "../index";
import { useTitle } from "../title";
import { BranchFilter, type Walked } from "./BranchFilter";
import { type Chip, Chips } from "./Chips";
import { graphTitle } from "./text";

type Head = Schemas["GraphHeadJson"];
type Repository = Schemas["RepositoryJson"];

const SLOW = 300; // ms going to a HEAD before its chip says so: most are done by then

/** A HEAD being gone to, by its chip. */
interface Towards {
  key: string;
  name: string;
  commit: string;
}

/** A Checkout of the Clone, where the graph shows it. */
interface Placed {
  head: Head;
  checkout: Checkout | undefined; // undefined if not registered
  name: string;
}

/**
 * The commits of a whole Clone, with their graph: walked from all its local branches and the
 * HEAD of each of its Checkouts, topologically by default (`order`), less the branches hidden
 * (`hide`). Its default branch keeps lane 0 and the accent, unless hidden; the HEAD of each Checkout is drawn
 * larger, named on its badge, with what is not committed above it. A chip per Checkout goes to
 * its HEAD, loading older commits until it shows (`at`, a Worktree's).
 */
export function GraphView({ params, setParams, setTitle }: ViewProps) {
  const checkout = checkoutOf(params);
  const order = orderOf(params, "topo");
  const hidden = paramValues(params.hide);
  const walked: Walked = paramValues(params.branches)[0] === "worktrees" ? "worktrees" : "local";
  const [at] = paramValues(params.at);
  const query: HistoryQuery | undefined = checkout && {
    ...checkout,
    branches: walked,
    order,
    ...(hidden.length === 0 ? {} : { hide: hidden }),
  };
  const history = useHistory(query);
  const graph = useGraph(checkout);
  const error = useKeptError(history, query);
  const client = useQueryClient();
  const repositories = useRepositories();
  useTitle(
    setTitle,
    graphTitle(checkout && checkoutName(repositories.data, checkout), hidden.length, walked),
  );
  const now = useNow(10_000);
  const [layout, setLayout] = useListLayout("graph");
  const page = useRef<HTMLElement>(null);

  const known = graph.data;
  const placed = (known?.heads ?? []).map((head) => place(head, repositories.data));
  const commits = history.data?.pages.flatMap((each) => each.commits) ?? [];
  const listed = withUncommitted(entries(commits), placed, repositories.data);
  // The default branch keeps lane 0 and the accent, unless hidden.
  const defaultBranch =
    known?.default_branch && !hidden.includes(known.default_branch) ? known.default_branch : null;
  const pinned = known?.branches.find((branch) => branch.name === defaultBranch)?.commit;
  const heads = new Set(placed.flatMap(({ head }) => (head.commit ? [head.commit] : [])));
  const checkedOut: CheckedOut[] = placed.map(({ head, name }) => ({
    name,
    worktree: !head.main,
    branch: head.branch,
    commit: head.commit,
  }));
  const chips: Chip[] = placed.map(({ head, name }) => ({
    key: head.path,
    name,
    worktree: !head.main,
    branch: head.branch,
    commit: head.commit,
    ahead: head.ahead,
    behind: head.behind,
    against: head.against,
    colour: chipColour(head, defaultBranch),
    hidden: head.branch !== null && hidden.includes(head.branch),
  }));

  // Going to a HEAD: older pages load until its row is listed, then it is scrolled to the top,
  // with what is not committed above it. Its chip says so, once it takes a while.
  const [towards, setTowards] = useState<Towards | null>(null);
  const [slow, setSlow] = useState(false);
  const [missed, setMissed] = useState<string | null>(null); // the key of the chip
  const [handled, setHandled] = useState<string | undefined>(undefined);
  const go = (chip: { key: string; name: string; commit: string | null }) => {
    setMissed(null);
    setSlow(false);
    setTowards(chip.commit ? { key: chip.key, name: chip.name, commit: chip.commit } : null);
  };
  const atHead = placed.find(({ head }) => head.worktree !== null && head.worktree === at);
  if (at !== handled && atHead !== undefined) {
    setHandled(at); // once per address: the Worktree it was opened at
    go({ key: atHead.head.path, name: atHead.name, commit: atHead.head.commit });
  }
  const loaded = history.data;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = history;
  useEffect(() => {
    if (towards === null || loaded === undefined) return;
    const listed = new Map(
      [...(page.current?.querySelectorAll("[data-entry]") ?? [])].map((each) => [
        each.getAttribute("data-entry"),
        each,
      ]),
    );
    const row = listed.get(towards.commit);
    if (row) {
      const top = listed.get(`uncommitted:${towards.key}`) ?? row;
      top.closest("li")?.scrollIntoView({ block: "start" });
      setTowards(null);
    } else if (!hasNextPage) {
      setMissed(towards.key); // e.g. its branch hidden
      setTowards(null);
    } else if (!isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [towards, loaded, hasNextPage, isFetchingNextPage, fetchNextPage]);
  useEffect(() => {
    if (towards === null) return;
    const wait = setTimeout(() => setSlow(true), SLOW);
    return () => clearTimeout(wait);
  }, [towards]);
  // Escape stops it, while the focus is in this View, as it closes Find.
  useEffect(() => {
    if (towards === null) return;
    const stop = (event: KeyboardEvent) => {
      if (event.key === "Escape" && page.current?.contains(document.activeElement)) {
        setTowards(null);
      }
    };
    document.addEventListener("keydown", stop);
    return () => document.removeEventListener("keydown", stop);
  }, [towards]);

  // The branches the filter lists: those walked, the default one first, hidden or not.
  const named = known?.default_branch ?? null;
  const out = new Set(placed.flatMap(({ head }) => (head.branch ? [head.branch] : [])));
  const filtered = (known?.branches ?? [])
    .map((each) => each.name)
    .filter((name) => walked === "local" || out.has(name) || name === named)
    .sort((a, b) => Number(b === named) - Number(a === named));
  const filter = (next: Walked, nextHidden: string[]) =>
    setParams(
      withParam(withParam(params, "branches", next === "local" ? [] : [next]), "hide", nextHidden),
    );

  const pick = (chip: Chip) => {
    if (towards?.key === chip.key) {
      setTowards(null); // a click on the chip gone to stops it
      return;
    }
    const head = placed.find((each) => each.head.path === chip.key);
    let next: Params = head?.head.worktree
      ? { ...params, at: head.head.worktree }
      : withParam(params, "at", []);
    if (chip.hidden && chip.branch !== null) {
      next = withParam(
        next,
        "hide",
        hidden.filter((name) => name !== chip.branch),
      );
    }
    setHandled(paramValues(next.at)[0]);
    setParams(next);
    go(chip);
  };

  let message: string | null = null;
  if (checkout === undefined) {
    message = "No clone: open the Graph from a clone or worktree in Repositories.";
  } else if (history.data === undefined && error === null) {
    message = "Loading commits…";
  } else if (history.data !== undefined && listed.length === 0) {
    message = hidden.length > 0 ? "No commits on the branches shown." : "No commits yet.";
  }
  if (isGone(error)) {
    return (
      <ViewPage>
        <Gone error={error} />
      </ViewPage>
    );
  }
  const current = placed.find(({ head }) => (at === undefined ? head.main : head.worktree === at))
    ?.head.path;
  return (
    <ViewPage ref={page}>
      <ViewBar>
        {checkout && (
          <BranchFilter walked={walked} branches={filtered} hidden={hidden} onChange={filter} />
        )}
        <BarEnd>
          <BarGroup>
            <OrderToggle
              order={order}
              onChange={(next) => setParams(withOrder(params, next, "topo"))}
            />
            <LayoutToggle layout={layout} onChange={setLayout} />
          </BarGroup>
          <BarGroup>
            <Refresh
              busy={history.isFetching || graph.isFetching}
              onClick={() => {
                void client.invalidateQueries({ queryKey: KEYS.history });
                void client.invalidateQueries({ queryKey: KEYS.graph });
              }}
            />
          </BarGroup>
        </BarEnd>
      </ViewBar>
      <Chips
        chips={chips}
        current={current}
        going={
          towards && slow
            ? {
                key: towards.key,
                text: `Loading towards ${towards.name}: ${numberText(commits.length)} commits so far`,
              }
            : undefined
        }
        missed={missed ?? undefined}
        onPick={pick}
      />
      {error && <LoadNote error={error} />}
      <CommitList
        kind="graph"
        checkout={checkout}
        entries={listed}
        head={undefined}
        layout={layout}
        now={now}
        message={message}
        stale={error !== null || history.isPlaceholderData}
        paging={history}
        graph={{
          heads,
          accent: "pinned",
          checkedOut,
          hidden: new Set(hidden),
          ...(pinned === undefined ? {} : { pinned }),
          ...(defaultBranch ? { first: defaultBranch } : {}),
        }}
      />
    </ViewPage>
  );
}

/** Where a HEAD is, by its Clone or Worktree as Repositories knows them, and its name. */
function place(head: Head, repositories: Repository[] | undefined): Placed {
  let checkout: Checkout | undefined;
  if (head.worktree) checkout = { worktree: head.worktree };
  else if (head.clone && head.main) checkout = { clone: head.clone };
  const name =
    (checkout && checkoutName(repositories, checkout)) ?? pathParts(head.path)[1] ?? head.path;
  return { head, checkout, name };
}

/** The entries with, above each HEAD listed, what is not committed in its Checkout, if any. */
function withUncommitted(
  listed: Entry[],
  placed: Placed[],
  repositories: Repository[] | undefined,
): Entry[] {
  const above = new Map<string, Entry[]>();
  for (const { head, checkout, name } of placed) {
    if (checkout === undefined || head.commit === null) continue;
    const text = uncommittedIn(checkoutState(repositories, checkout));
    if (!text) continue;
    const row: Entry = {
      type: "uncommitted",
      text: `Uncommitted in ${name}: ${text}`,
      of: { checkout, head: head.commit, key: head.path },
    };
    above.set(head.commit, [...(above.get(head.commit) ?? []), row]);
  }
  return listed.flatMap((entry) =>
    entry.type === "commit" ? [...(above.get(entry.commit.hash) ?? []), entry] : [entry],
  );
}

/** The colour of a Checkout's chip: that of its branch's line, the default branch's accent
 * (`defaultBranch`, null while hidden). */
function chipColour(head: Head, defaultBranch: string | null): string {
  if (head.branch !== null && head.branch === defaultBranch) return "var(--accent)";
  if (head.branch !== null) return hueColour(hueOf(head.branch));
  return hueColour(hueOf(head.commit ?? head.path), true);
}

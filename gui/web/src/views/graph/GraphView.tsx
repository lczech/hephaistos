import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Schemas } from "../../api/client";
import {
  type HistoryQuery,
  KEYS,
  useGraph,
  useGraphLines,
  useHistory,
  useRepositories,
} from "../../api/queries";
import type { Picked } from "../../components/GitRevisionPicker";
import { GoToRevision } from "../../components/GoToRevision";
import { useListLayout } from "../../components/list/kept";
import { LayoutToggle } from "../../components/list/LayoutToggle";
import type { ListHandle } from "../../components/list/List";
import { BarEnd, BarGroup, Refresh, ViewBar, ViewPage } from "../../components/ViewBar";
import { pathParts } from "../../paths";
import { numberText } from "../../text";
import { useNow } from "../../useNow";
import { paramValues, withParam } from "../address";
import { Gone, isGone, LoadNote, useKeptError } from "../CheckoutError";
import { type Checkout, checkoutName, checkoutOf, checkoutState } from "../checkout";
import { CommitList } from "../commits/CommitList";
import { colourOf } from "../commits/Graph";
import { OrderToggle, orderOf, withOrder } from "../commits/OrderToggle";
import {
  type CheckedOut,
  type Drawing,
  type Drawn,
  entries,
  entryId,
  graphOf,
  type Laid,
  tipsEntries,
  type Uncommitted,
  uncommittedIn,
} from "../commits/rows";
import type { ViewProps } from "../index";
import { useTitle } from "../title";
import { BranchFilter, type Walked } from "./BranchFilter";
import { type Chip, Chips } from "./Chips";
import { TipsToggle, tipsOnlyOf, withTipsOnly } from "./TipsToggle";
import { graphTitle } from "./text";

type Head = Schemas["GraphHeadJson"];
type Repository = Schemas["RepositoryJson"];

// How far ahead of the list to lay out the lines of the HEADs, at most: ~100-200 ms on git.git
// (`/api/graph/lines`); most HEADs come long before, that of a stale Worktree may never.
const LINES_LIMIT = 10_000;

const GO_TO = "go-to"; // the key of going to what was picked, as that of a chip is its path
const LOCAL = "refs/heads/";

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
 * (`hide`). Its default branch keeps lane 0 and the accent, unless hidden; the HEAD of each
 * Checkout is drawn larger, named on its badge, with what is not committed above it. A chip per
 * Checkout, marked in the colour of the line of its HEAD, goes to its HEAD, loading older commits
 * until it shows; it opens at that of a Worktree (`at`). With branch tips only (`tips`), it shows
 * only the commits where something happens, in one page, those between them counted (`tips.py`).
 */
export function GraphView({ params, setParams, setTitle }: ViewProps) {
  const checkout = checkoutOf(params);
  const order = orderOf(params, "topo");
  const hidden = paramValues(params.hide);
  const walked: Walked = paramValues(params.branches)[0] === "worktrees" ? "worktrees" : "local";
  const [at] = paramValues(params.at);
  const tipsOnly = tipsOnlyOf(params);
  // The walk: from which branches, less those hidden, in which order; of the Clone of the Checkout.
  const walking = { branches: walked, order, ...(hidden.length === 0 ? {} : { hide: hidden }) };
  const walk = checkout && { ...checkout, ...walking };
  const graph = useGraph(checkout);
  const repositories = useRepositories();
  const known = graph.data;
  const placed = (known?.heads ?? []).map((head) => place(head, repositories.data));
  const above = uncommittedAbove(placed, repositories.data);
  // With branch tips only, the HEADs of Checkouts on hidden branches kept too, where something is
  // not committed: it shows above them, as with all commits.
  const keep = tipsOnly ? keptHeads(placed, above, hidden) : [];
  const query: HistoryQuery | undefined =
    walk && (tipsOnly ? { ...walk, tips: true, ...(keep.length > 0 ? { keep } : {}) } : walk);
  const history = useHistory(query);
  const error = useKeptError(history, query);
  const client = useQueryClient();
  useTitle(
    setTitle,
    graphTitle(
      checkout && checkoutName(repositories.data, checkout),
      hidden.length,
      walked,
      tipsOnly,
    ),
  );
  const now = useNow(10_000);
  const [layout, setLayout] = useListLayout("graph");
  const page = useRef<HTMLElement>(null);
  const list = useRef<ListHandle>(null);

  const commits = history.data?.pages.flatMap((each) => each.commits) ?? [];
  // Branch tips only as the rows have them: those of all commits shown until they come, and back.
  const between = history.data?.pages[0]?.lines;
  const tips = between ? tipsEntries(commits, between) : undefined;
  const listed = withUncommitted(tips?.entries ?? entries(commits), above);
  // The default branch keeps lane 0 and the accent, unless hidden.
  const defaultBranch =
    known?.default_branch && !hidden.includes(known.default_branch) ? known.default_branch : null;
  // Where it is as the rows listed have it: `/api/graph` may answer later than they do, or
  // sooner, a commit just made on it laid out beside lane 0 until both agree.
  const pinned =
    defaultBranch === null
      ? undefined
      : history.data?.pages[0]?.refs.find(
          (ref) => ref.kind === "branch" && ref.name === defaultBranch,
        )?.commit;
  const heads = new Set(placed.flatMap(({ head }) => (head.commit ? [head.commit] : [])));
  const checkedOut: CheckedOut[] = placed.map(({ head, name }) => ({
    name,
    path: head.path,
    worktree: !head.main,
    branch: head.branch,
    commit: head.commit,
  }));
  const drawing: Drawing = {
    heads,
    accent: "pinned",
    checkedOut,
    hidden: new Set(hidden),
    ...(pinned === undefined ? {} : { pinned }),
    ...(defaultBranch ? { first: defaultBranch } : {}),
    ...(tips ? { parents: tips.parents } : {}),
  };
  // The lines of the HEADs, laid out as the list will be, before their pages are listed.
  // Until the HEADs walked: that of a hidden branch may be on no line walked, which would then
  // be walked to the limit for it.
  const walkedHeads = placed.flatMap(({ head }) =>
    head.commit && !(head.branch !== null && hidden.includes(head.branch)) ? [head.commit] : [],
  );
  // With branch tips only, all HEADs are among the rows, drawn as the list draws them.
  const lines = useGraphLines(
    walk && known && !tips ? { ...walk, until: walkedHeads, limit: LINES_LIMIT } : undefined,
  );
  const laid = tips
    ? graphOf(listed, undefined, drawing)
    : lines.data &&
      graphOf(
        withUncommitted(
          lines.data.commits.map((commit): Laid => ({ type: "commit", commit })),
          above,
        ),
        undefined,
        drawing,
      );
  const chips: Chip[] = placed.map(({ head, name }) => ({
    key: head.path,
    name,
    worktree: !head.main,
    branch: head.branch,
    commit: head.commit,
    ahead: head.ahead,
    behind: head.behind,
    against: head.against,
    colour: lineColour(head, laid, defaultBranch),
    hidden: head.branch !== null && hidden.includes(head.branch),
  }));

  // Going to a commit, the HEAD of a chip or one picked: older pages load until its row is
  // listed, then it is scrolled to the top, with what is not committed above it. Its chip or the
  // picker says so, once it takes a while. Whether it is on the walk at all, the lines say first,
  // where those laid out ahead do not have it: a tag elsewhere is not looked for page after page.
  const [towards, setTowards] = useState<Towards | null>(null);
  const [slow, setSlow] = useState(false);
  const [missedOnce, setMissed] = useState<Towards | null>(null);
  const [handled, setHandled] = useState<string | undefined>(undefined);
  const go = (target: { key: string; name: string; commit: string | null | undefined }) => {
    setMissed(null);
    setSlow(false);
    setTowards(
      target.commit ? { key: target.key, name: target.name, commit: target.commit } : null,
    );
  };
  const reach = useGraphLines(
    walk && towards && !tips && !laid?.rows.has(towards.commit)
      ? { ...walk, until: [towards.commit], limit: LINES_LIMIT }
      : undefined,
  );
  const offWalk =
    towards !== null &&
    reach.data !== undefined &&
    !reach.isPlaceholderData &&
    reach.data.commits.length < LINES_LIMIT &&
    !reach.data.commits.some((line) => line.hash === towards.commit);
  const atHead = placed.find(({ head }) => head.worktree !== null && head.worktree === at);
  if (at !== handled && atHead !== undefined) {
    setHandled(at); // once per address: the Worktree it was opened at
    go({ key: atHead.head.path, name: atHead.name, commit: atHead.head.commit });
  }
  const loaded = history.data;
  const { hasNextPage, isFetching, fetchNextPage } = history;
  // The row gone to, once listed: what is not committed above its commit, if any, else that.
  const ids = new Set(listed.map(entryId));
  // Missed no longer once it shows, e.g. after a refresh brought it back.
  const missed = missedOnce !== null && !ids.has(missedOnce.commit) ? missedOnce : null;
  const reached =
    towards === null || !ids.has(towards.commit)
      ? undefined
      : ids.has(`uncommitted:${towards.key}`)
        ? `uncommitted:${towards.key}`
        : towards.commit;
  // Not in the rows of the previous walk, shown while another loads, e.g. a hidden branch shown
  // again to go to it: its pages say nothing of those of the new walk.
  const previous = history.isPlaceholderData;
  useEffect(() => {
    if (towards === null || loaded === undefined || previous) return;
    if (reached !== undefined) {
      // Focused, unless the focus went elsewhere meanwhile, e.g. to a terminal in another Group.
      list.current?.goTo(reached, { focus: !focusElsewhere(page.current) });
      setTowards(null);
    } else if (!hasNextPage || offWalk) {
      setMissed(towards); // e.g. its branch hidden, or a tag on none walked
      setTowards(null);
    } else if (!isFetching) {
      void fetchNextPage(); // not while all pages load anew: it would cut that short (`Paging`)
    }
  }, [towards, loaded, previous, reached, hasNextPage, isFetching, fetchNextPage, offWalk]);
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
    // Only a jump, the address kept where the Graph opened; a hidden branch is shown again.
    if (chip.hidden && chip.branch !== null) {
      const branch = chip.branch;
      setParams(
        withParam(
          params,
          "hide",
          hidden.filter((name) => name !== branch),
        ),
      );
    }
    go(chip);
  };

  // A branch, tag or commit picked to go to; a hidden branch shown again.
  const goTo = (picked: Picked) => {
    const branch = picked.revision.startsWith(LOCAL)
      ? picked.revision.slice(LOCAL.length)
      : undefined;
    if (branch !== undefined && hidden.includes(branch)) {
      setParams(
        withParam(
          params,
          "hide",
          hidden.filter((name) => name !== branch),
        ),
      );
    }
    go({ key: GO_TO, name: picked.name, commit: picked.commit });
  };
  const going = towards && {
    what: `Loading towards ${towards.name}`,
    far: `${numberText(commits.length)} commits so far`,
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
        {checkout && (
          <GoToRevision
            checkout={checkout}
            commitsFrom={walking}
            known={history.data?.pages[0]}
            onPick={goTo}
            going={towards?.key === GO_TO && slow && going ? going : undefined}
            missed={
              missed?.key === GO_TO ? `${missed.name} is not among the commits shown` : undefined
            }
            onStop={() => setTowards(null)}
          />
        )}
        <BarEnd>
          <BarGroup>
            <OrderToggle
              order={order}
              onChange={(next) => setParams(withOrder(params, next, "topo"))}
            />
            <TipsToggle
              only={tipsOnly}
              onChange={(only) => setParams(withTipsOnly(params, only))}
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
          towards && towards.key !== GO_TO && slow && going
            ? { key: towards.key, ...going }
            : undefined
        }
        missed={missed?.key}
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
        graph={drawing}
        handle={list}
        onTip={(id) => list.current?.goTo(id)}
      />
    </ViewPage>
  );
}

/** Whether the focus is somewhere else than in this View, or nowhere: in its popovers is in it. */
function focusElsewhere(page: HTMLElement | null): boolean {
  const at = document.activeElement;
  if (at === null || at === document.body || page?.contains(at)) return false;
  return at.closest("[role=dialog]") === null;
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

/** What is not committed in each Checkout, as rows above its HEAD, by the commit of the HEAD. */
function uncommittedAbove(
  placed: Placed[],
  repositories: Repository[] | undefined,
): Map<string, Uncommitted[]> {
  const above = new Map<string, Uncommitted[]>();
  for (const { head, checkout, name } of placed) {
    if (checkout === undefined || head.commit === null) continue;
    const text = uncommittedIn(checkoutState(repositories, checkout));
    if (!text) continue;
    const row: Uncommitted = {
      type: "uncommitted",
      text: `Uncommitted in ${name}: ${text}`,
      of: { checkout, head: head.commit, key: head.path },
    };
    above.set(head.commit, [...(above.get(head.commit) ?? []), row]);
  }
  return above;
}

/** The commits of the HEADs of Checkouts on branches `hidden`, with what is not committed. */
function keptHeads(placed: Placed[], above: Map<string, Uncommitted[]>, hidden: string[]) {
  const kept = placed.flatMap(({ head }) =>
    head.commit !== null &&
    head.branch !== null &&
    hidden.includes(head.branch) &&
    above.get(head.commit)?.some((row) => row.of?.key === head.path)
      ? [head.commit]
      : [],
  );
  return [...new Set(kept)].sort();
}

/** The rows with what is not committed above each HEAD listed: in the list, or laid out. */
function withUncommitted<E extends Laid>(
  listed: E[],
  above: Map<string, Uncommitted[]>,
): (E | Uncommitted)[] {
  return listed.flatMap((entry) =>
    entry.type === "commit"
      ? [...(above.get((entry as Extract<Laid, { type: "commit" }>).commit.hash) ?? []), entry]
      : [entry],
  );
}

/**
 * The colour of the line the HEAD of a Checkout is on, as the list draws it: from the lines laid
 * out ahead of the list, which may not reach it; until they do, the accent if on the default
 * branch (`defaultBranch`, null while hidden), else none.
 */
function lineColour(head: Head, laid: Drawn | undefined, defaultBranch: string | null) {
  const row = head.commit === null ? undefined : laid?.rows.get(head.commit);
  const line = row === undefined ? undefined : laid?.layout.rows[row];
  if (line !== undefined) return colourOf(line.colour);
  return head.branch !== null && head.branch === defaultBranch ? "var(--accent)" : undefined;
}

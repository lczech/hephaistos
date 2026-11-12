import { useQueryClient } from "@tanstack/react-query";
import { type HistoryQuery, KEYS, useGraph, useHistory, useRepositories } from "../../api/queries";
import { useListLayout } from "../../components/list/kept";
import { LayoutToggle } from "../../components/list/LayoutToggle";
import { BarEnd, BarGroup, Refresh, ViewBar, ViewPage } from "../../components/ViewBar";
import { useNow } from "../../useNow";
import { paramValues } from "../address";
import { Gone, isGone, LoadNote, useKeptError } from "../CheckoutError";
import { checkoutName, checkoutOf } from "../checkout";
import { CommitList } from "../commits/CommitList";
import { OrderToggle, orderOf, withOrder } from "../commits/OrderToggle";
import { entries } from "../commits/rows";
import type { ViewProps } from "../index";
import { useTitle } from "../title";
import { graphTitle } from "./text";

/**
 * The commits of a whole Clone, with their graph: walked from all its local branches and the
 * HEAD of each of its Checkouts, topologically by default (`order`), less the branches hidden
 * (`hide`). Its default branch keeps lane 0 and the accent; HEADs are drawn larger.
 */
export function GraphView({ params, setParams, setTitle }: ViewProps) {
  const checkout = checkoutOf(params);
  const order = orderOf(params, "topo");
  const hidden = paramValues(params.hide);
  const query: HistoryQuery | undefined = checkout && {
    ...checkout,
    branches: "local",
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
    graphTitle(checkout && checkoutName(repositories.data, checkout), hidden.length),
  );
  const now = useNow(10_000);
  const [layout, setLayout] = useListLayout("graph");

  const first = history.data?.pages[0];
  const listed = entries(history.data?.pages.flatMap((page) => page.commits) ?? []);
  const known = graph.data;
  const pinned = known?.branches.find((branch) => branch.name === known.default_branch)?.commit;
  const heads = new Set(known?.heads.flatMap((head) => (head.commit ? [head.commit] : [])) ?? []);

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
  return (
    <ViewPage>
      <ViewBar>
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
      {error && <LoadNote error={error} />}
      <CommitList
        kind="graph"
        checkout={checkout}
        entries={listed}
        head={first?.head}
        layout={layout}
        now={now}
        message={message}
        stale={error !== null || history.isPlaceholderData}
        paging={history}
        graph={{ heads, ...(pinned === undefined ? {} : { pinned }) }}
      />
    </ViewPage>
  );
}

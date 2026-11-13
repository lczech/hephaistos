import { ClockArrowDown } from "lucide-react";
import { Toggle } from "../../components/ViewBar";
import { GitGraphArrowDown } from "../../drawnIcons";
import { type Params, paramValues, withParam } from "../address";

/** The orders a graph can be drawn in: each commit only after all its children. */
export type Order = "topo" | "date";

/** The order the parameters of a View ask for (`order`), else `fallback`. */
export function orderOf(params: Params, fallback: Order): Order {
  const [asked] = paramValues(params.order);
  return asked === "topo" || asked === "date" ? asked : fallback;
}

/** The parameters with `order`, left out where it is that of the View itself. */
export function withOrder(params: Params, order: Order, fallback: Order): Params {
  return withParam(params, "order", order === fallback ? [] : [order]);
}

/** Topological order or date order, the two ways a list of commits with its graph is ordered. */
export function OrderToggle({
  order,
  onChange,
}: {
  order: Order;
  onChange: (order: Order) => void;
}) {
  return (
    <Toggle
      label="Topological order"
      on={order === "topo"}
      onChange={(on) => onChange(on ? "topo" : "date")}
      ways={[
        {
          icon: GitGraphArrowDown,
          title: "Topological order: each line of commits together, below its children",
        },
        { icon: ClockArrowDown, title: "Date order: newest first, each commit below its children" },
      ]}
    />
  );
}

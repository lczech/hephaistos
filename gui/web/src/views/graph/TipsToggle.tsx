import { FoldVertical, UnfoldVertical } from "lucide-react";
import { Toggle } from "../../components/ViewBar";
import { type Params, paramValues, withParam } from "../address";

/** Whether the parameters of the Graph View ask for branch tips only (`tips=only`). */
export function tipsOnlyOf(params: Params): boolean {
  return paramValues(params.tips)[0] === "only";
}

/** The parameters with branch tips only, or all commits, left out of the address. */
export function withTipsOnly(params: Params, only: boolean): Params {
  return withParam(params, "tips", only ? ["only"] : []);
}

/** All commits, or branch tips only, the commits between them counted. */
export function TipsToggle({
  only,
  onChange,
}: {
  only: boolean;
  onChange: (only: boolean) => void;
}) {
  return (
    <Toggle
      label="All commits"
      on={!only}
      onChange={(all) => onChange(!all)}
      ways={[
        { icon: UnfoldVertical, title: "Show all commits" },
        { icon: FoldVertical, title: "Show branch tips only, the commits between counted" },
      ]}
    />
  );
}

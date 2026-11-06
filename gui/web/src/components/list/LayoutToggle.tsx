import { Table } from "lucide-react";
import { TableLines } from "../../drawnIcons";
import { Toggle } from "../ViewBar";
import type { ListLayout } from "./kept";

interface Props {
  layout: ListLayout;
  onChange: (layout: ListLayout) => void;
}

/** In a View's bar: its list in columns, or each row in two lines. */
export function LayoutToggle({ layout, onChange }: Props) {
  return (
    <Toggle
      label="Columns"
      on={layout === "columns"}
      onChange={(on) => onChange(on ? "columns" : "lines")}
      ways={[
        { icon: Table, title: "In columns, lined up; too many scroll sideways" },
        { icon: TableLines, title: "Each row in two lines, as narrow panels need" },
      ]}
    />
  );
}

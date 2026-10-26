import { Sheet } from "lucide-react";
import type { Schemas } from "../../api/client";
import { useDbRows, useDbTables } from "../../api/queries";
import { Picker } from "../../components/Picker";
import { TextIcon } from "../../components/TextIcon";
import { Fields } from "../../components/table/Fields";
import { Chevron, ListTable } from "../../components/table/ListTable";
import { listColumnHelper, useListTable } from "../../components/table/list";
import { ViewBar, ViewPage } from "../../components/ViewBar";
import { paramValues, withParam } from "../address";
import type { ViewProps } from "../index";
import { useTitle } from "../title";
import { cellText, type ValueType } from "./cells";
import styles from "./DbView.module.css";

type Row = Record<string, unknown>;
type Column = Schemas["ColumnJson"];
type Table = Schemas["TableJson"];

const NONE: Row[] = [];
const NO_TABLES: Table[] = [];
const OPEN = "#"; // the square's column, named apart from any table's
const ALL = ""; // the picker's first choice: all tables, as no table names none

/** A value in a cell; NULL quieter; clocks and times stored as they are, when hovered. */
function Value({ value, type }: { value: unknown; type: ValueType }) {
  const text = cellText(value, type);
  if (text === null) return <span className={styles.null}>NULL</span>;
  return typeof value === "string" && text !== value ? <span title={value}>{text}</span> : text;
}

const column = listColumnHelper<Row>();

function tableColumns(columns: Column[]) {
  return column.columns([
    column.display({
      id: OPEN,
      cell: Chevron,
      enableResizing: false,
      meta: { width: "var(--square)" },
    }),
    ...columns.map(({ name, type }) =>
      column.display({
        id: name,
        header: name,
        size: 140,
        meta: { description: `Type: ${type}` },
        cell: ({ row }) => <Value value={row.original[name]} type={type} />,
      }),
    ),
  ]);
}

/** The database as stored: its tables, or one table's rows, as `hephaistos db` shows them. */
export function DbView({ params, setParams, setTitle }: ViewProps) {
  const [table] = paramValues(params.table);
  useTitle(setTitle, table === undefined ? "Database" : `Database: ${table}`);
  const show = (name: string | undefined) =>
    setParams(withParam(params, "table", name === undefined ? [] : [name]));
  return table === undefined ? (
    <Tables show={show} />
  ) : (
    <Rows key={table} table={table} show={show} />
  );
}

function Warnings({ warnings }: { warnings: string[] }) {
  return warnings.map((warning) => (
    <p key={warning} className={styles.warning}>
      {warning}
    </p>
  ));
}

const tableColumn = listColumnHelper<Table>();

/** The tables' columns: a sheet in the square, as each row shows that table, then `db tables`'. */
const TABLE_COLUMNS = tableColumn.columns([
  tableColumn.display({
    id: OPEN,
    cell: () => <TextIcon icon={Sheet} className={styles.sheet} />,
    enableResizing: false,
    meta: { width: "var(--square)" },
  }),
  tableColumn.accessor("table", { header: "table", size: 200, meta: { identifies: true } }),
  tableColumn.display({
    id: "category",
    header: "category",
    size: 100,
    cell: ({ row }) => {
      const { category } = row.original;
      return category === null ? <span className={styles.warning}>unknown</span> : category;
    },
  }),
  tableColumn.display({
    id: "rows",
    header: "rows",
    size: 80,
    meta: { end: true, figures: true },
    cell: ({ row }) => <span className={styles.number}>{row.original.rows ?? "missing"}</span>,
  }),
  tableColumn.display({
    id: "latest",
    header: "latest",
    size: 220,
    meta: { figures: true },
    cell: ({ row }) => cellText(row.original.latest, "clock") ?? "-",
  }),
]);

/** The tables, as `db tables` lists them; a row shows its table's rows, in place. */
function Tables({ show }: { show: (table: string) => void }) {
  const tables = useDbTables();
  const listTable = useListTable("db", "columns", {
    columns: TABLE_COLUMNS,
    data: tables.data?.tables ?? NO_TABLES,
    getRowId: ({ table }) => table,
  });
  let message: string | null = null;
  if (tables.data === undefined) {
    message = tables.isError ? `Couldn't load: ${tables.error.message}` : "Loading tables…";
  }
  return (
    <ViewPage>
      <Warnings warnings={tables.data?.warnings ?? []} />
      <ListTable
        table={listTable}
        layout="columns"
        choices={{}}
        message={message}
        stale={tables.isError}
        older="tables"
        detailsLabel="Table details"
        details={() => null}
        // Not a link: the View shows another of its tables, as its picker does.
        opens={({ table }) =>
          (click) =>
            click.button === 0 && show(table)
          }
      />
    </ViewPage>
  );
}

interface RowsProps {
  table: string;
  show: (table: string | undefined) => void;
}

/** A table's rows, newest first, every column; more as the end comes into view. */
function Rows({ table, show }: RowsProps) {
  const rows = useDbRows(table);
  const tables = useDbTables().data?.tables;
  const pages = rows.data?.pages;
  // The first page's columns: those of the newest rows, refreshed with all pages.
  const columns = tableColumns(pages?.[0]?.columns ?? []);
  // A row is its values: tables share no key. A row on two pages, moved on by a newer one, shows once.
  const unique = new Map<string, Row>();
  for (const row of pages?.flatMap((page) => page.rows) ?? NONE) {
    unique.set(JSON.stringify(row), row);
  }
  const listed = [...unique.values()];
  const listTable = useListTable(`db.${table}`, "columns", {
    columns,
    data: listed,
    getRowId: (row) => JSON.stringify(row),
  });
  let message: string | null = null;
  if (pages === undefined) {
    message = rows.isError ? `Couldn't load: ${rows.error.message}` : "Loading rows…";
  } else if (listed.length === 0) {
    message = "No rows.";
  }
  const shown = pages?.[0]?.columns ?? [];
  const count = tables?.find((each) => each.table === table)?.rows;
  return (
    <ViewPage>
      <ViewBar>
        <Picker
          label="Table"
          title="Show another table"
          picks={[
            { id: ALL, text: "All tables" },
            ...(tables ?? []).map(({ table: name, rows: count }) => ({
              id: name,
              text: count === null ? name : `${name} (${count})`,
            })),
          ]}
          picked={table}
          onPick={(id) => show(id === ALL ? undefined : id)}
        >
          {table}
          {count !== undefined && count !== null && ` (${count})`}
        </Picker>
        <Warnings warnings={pages?.[0]?.warnings ?? []} />
      </ViewBar>
      <ListTable
        table={listTable}
        layout="columns" // no two lines for a table's rows, which may have any columns
        choices={{}}
        message={message}
        stale={rows.isError}
        paging={rows}
        older="rows"
        detailsLabel="Row details"
        details={(row) => (
          <Fields
            fields={shown.map(({ name, type }) => [name, cellText(row[name], type) ?? "NULL"])}
          />
        )}
      />
    </ViewPage>
  );
}

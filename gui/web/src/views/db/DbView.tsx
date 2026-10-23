import type { Schemas } from "../../api/client";
import { useDbRows, useDbTables } from "../../api/queries";
import { Fields } from "../../components/table/Fields";
import { columnWidths } from "../../components/table/kept";
import { Chevron, ListTable } from "../../components/table/ListTable";
import { listColumnHelper, useListTable } from "../../components/table/list";
import { paramValues, withParam } from "../address";
import type { ViewProps } from "../index";
import { useTitle } from "../title";
import { cellText, type ValueType } from "./cells";
import styles from "./DbView.module.css";

type Row = Record<string, unknown>;
type Column = Schemas["ColumnJson"];

const NONE: Row[] = [];
const OPEN = "#"; // the square's column, named apart from any table's

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

/** The tables, as `db tables` lists them; choosing one shows its rows. */
function Tables({ show }: { show: (table: string) => void }) {
  const tables = useDbTables();
  if (tables.data === undefined) {
    const text = tables.isError ? `Couldn't load: ${tables.error.message}` : "Loading tables…";
    return <p className={styles.quiet}>{text}</p>;
  }
  return (
    <section className={styles.tables} data-stale={tables.isError || undefined}>
      <Warnings warnings={tables.data.warnings} />
      <div className={styles.grid}>
        {["table", "category", "rows", "latest"].map((label) => (
          <span key={label} className={styles.quiet}>
            {label}
          </span>
        ))}
        {tables.data.tables.map(({ table, category, rows, latest }) => (
          <div key={table} className={styles.table}>
            <button type="button" className={styles.link} onClick={() => show(table)}>
              {table}
            </button>
            <span className={category === null ? styles.warning : undefined}>
              {category ?? "unknown"}
            </span>
            <span className={styles.number}>{rows ?? "missing"}</span>
            <span className={styles.quiet}>{cellText(latest, "clock") ?? "-"}</span>
          </div>
        ))}
      </div>
    </section>
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
  const listTable = useListTable({
    columns,
    data: listed,
    getRowId: (row) => JSON.stringify(row),
    atoms: { columnSizing: columnWidths(`db.${table}`) },
  });
  let message: string | null = null;
  if (pages === undefined) {
    message = rows.isError ? `Couldn't load: ${rows.error.message}` : "Loading rows…";
  } else if (listed.length === 0) {
    message = "No rows.";
  }
  const shown = pages?.[0]?.columns ?? [];
  return (
    <div className={styles.rows}>
      <nav className={styles.bar}>
        <button type="button" className={styles.link} onClick={() => show(undefined)}>
          All tables
        </button>
        <select
          aria-label="Table"
          value={table}
          onChange={(event) => show(event.currentTarget.value)}
        >
          {(tables ?? [{ table, rows: null }]).map(({ table: name, rows: count }) => (
            <option key={name} value={name}>
              {count === null ? name : `${name} (${count})`}
            </option>
          ))}
        </select>
        <Warnings warnings={pages?.[0]?.warnings ?? []} />
      </nav>
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
    </div>
  );
}

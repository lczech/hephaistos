import { Funnel } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";
import { placeBelow } from "../popover";
import popover from "../popover.module.css";
import { type ColumnLook, Resizer } from "./columns";
import { type Choice, filterText, toggled } from "./filters";
import styles from "./table.module.css";

/** What TanStack Table's headers offer, of a list with column filtering, sizing and resizing. */
interface Header {
  column: {
    id: string;
    columnDef: { meta?: ColumnLook };
    getFilterValue: () => unknown;
    setFilterValue: (value: string[] | undefined) => void;
    getCanResize: () => boolean;
    getIsResizing: () => boolean;
    resetSize: () => void;
  };
  getResizeHandler: () => (event: unknown) => void;
}

interface Props {
  header: Header;
  choices?: Choice[]; // what its filter offers; none while they load
  children?: ReactNode; // the column's label
}

/**
 * A column's header: its label, and its filter if it has one, saying what it is set to and
 * opening the choices; its edge resizes the column.
 */
export function ColumnHeader({ header, choices = [], children }: Props) {
  const { column } = header;
  const filter = column.columnDef.meta?.filter;
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const values = (column.getFilterValue() as string[] | undefined) ?? [];
  const set = (chosen: string[]) => column.setFilterValue(chosen.length ? chosen : undefined);
  const text = values.length > 0 ? filterText(values, choices, filter?.many) : undefined;
  return (
    <span
      className={styles.header}
      data-column={column.id}
      data-filterable={filter !== undefined || undefined}
      data-filtered={text !== undefined || undefined}
    >
      {filter === undefined ? (
        <span className={styles.label}>{children}</span>
      ) : (
        <>
          <button
            type="button"
            className={styles.filter}
            popoverTarget={id}
            onClick={(event) => placeBelow(menu.current, event.currentTarget, "left")}
            aria-label={`Filter by ${column.id}`}
            title={text === undefined ? `Filter by ${column.id}` : `${column.id}: ${text}`}
          >
            {children !== undefined && (
              <span className={styles.label}>
                {children}
                {text !== undefined && `: ${text}`}
              </span>
            )}
            <Funnel className={styles.funnel} aria-hidden="true" />
          </button>
          <div id={id} ref={menu} popover="auto" className={`${popover.menu} ${styles.menu}`}>
            {filter.many === undefined ? (
              <OneChoice choices={choices} values={values} set={set} menu={id} />
            ) : (
              <ManyChoices choices={choices} values={values} set={set} />
            )}
          </div>
        </>
      )}
      {column.getCanResize() && <Resizer header={header} />}
    </span>
  );
}

interface ChoicesProps {
  choices: Choice[];
  values: string[];
  set: (values: string[]) => void;
}

/** One of the choices, or all: choosing closes the menu. */
function OneChoice({ choices, values, set, menu }: ChoicesProps & { menu: string }) {
  const [chosen] = values;
  const entries: { value: string | undefined; label: string }[] = [
    { value: undefined, label: "all" },
    ...choices,
  ];
  return (
    <ul className={styles.choices}>
      {entries.map(({ value, label }) => (
        <li key={value ?? ""}>
          <button
            type="button"
            className={styles.choice}
            aria-pressed={value === chosen}
            popoverTarget={menu}
            popoverTargetAction="hide"
            onClick={() => set(value === undefined ? [] : [value])}
          >
            {label}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Any of the choices: none ticked filters nothing. */
function ManyChoices({ choices, values, set }: ChoicesProps) {
  const entry = (choice: Choice, within?: Choice) => (
    <li key={choice.value}>
      <span className={styles.entry}>
        <label className={styles.tick}>
          <input
            type="checkbox"
            checked={
              values.includes(choice.value) ||
              (within !== undefined && values.includes(within.value))
            }
            onChange={() => set(toggled(values, choice, within))}
          />
          {choice.label}
        </label>
        <button
          type="button"
          className={styles.only}
          aria-label={`Only ${choice.label}`}
          onClick={() => set([choice.value])}
        >
          only
        </button>
      </span>
      {choice.choices !== undefined && (
        <ul className={styles.choices}>{choice.choices.map((inner) => entry(inner, choice))}</ul>
      )}
    </li>
  );
  return (
    <>
      <button
        type="button"
        className={styles.choice}
        disabled={values.length === 0}
        onClick={() => set([])}
      >
        Clear
      </button>
      <ul className={styles.choices}>{choices.map((choice) => entry(choice))}</ul>
    </>
  );
}

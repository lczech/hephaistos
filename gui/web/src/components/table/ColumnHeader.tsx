import { ArrowDown, ArrowUp, Funnel } from "lucide-react";
import { type ReactNode, type RefObject, useRef } from "react";
import {
  Dialog,
  DialogTrigger,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Pressable,
} from "react-aria-components";
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
    getCanSort: () => boolean;
    getIsSorted: () => false | "asc" | "desc";
    getToggleSortingHandler: () => undefined | ((event: unknown) => void);
    getIsResizing: () => boolean;
  };
  getResizeHandler: () => (event: unknown) => void;
}

interface Props {
  header: Header;
  choices?: Choice[]; // what its filter offers; none while they load
  onFit: (header: HTMLElement) => void; // fits the column to its cells
  children?: ReactNode; // the column's label
}

/**
 * A column's header: its label, saying what its filter is set to, which sorts by the column if it
 * can; at its end a funnel opening the filter's choices, if it has one; its edge resizes it.
 */
export function ColumnHeader({ header, choices = [], onFit, children }: Props) {
  const { column } = header;
  const own = useRef<HTMLSpanElement>(null);
  const values = (column.getFilterValue() as string[] | undefined) ?? [];
  const look = column.columnDef.meta?.filter;
  const filter = look?.linked && values.length === 0 ? undefined : look;
  const set = (chosen: string[]) => column.setFilterValue(chosen.length ? chosen : undefined);
  const text = values.length > 0 ? filterText(values, choices, filter?.many) : undefined;
  const description = column.columnDef.meta?.description;
  return (
    <span
      ref={own}
      className={styles.header}
      data-column={column.id}
      data-end={column.columnDef.meta?.end || undefined}
      data-filterable={filter !== undefined || undefined}
      data-sortable={column.getCanSort() || undefined}
      data-filtered={text !== undefined || undefined}
    >
      {children !== undefined &&
        (column.getCanSort() ? (
          <SortButton column={column} description={description}>
            {children}
          </SortButton>
        ) : (
          <span className={styles.label} title={lines(description, text)}>
            {children}
            {text !== undefined && `: ${text}`}
          </span>
        ))}
      {filter !== undefined && (
        <Filter
          header={own}
          name={column.id}
          text={text}
          choices={
            filter.many === undefined ? (
              <OneChoice choices={choices} values={values} set={set} name={column.id} />
            ) : (
              <Dialog
                className={`${popover.menu} ${styles.menu}`}
                aria-label={`Filter by ${column.id}`}
              >
                <ManyChoices choices={choices} values={values} set={set} />
              </Dialog>
            )
          }
          menu={filter.many === undefined}
        />
      )}
      {column.getCanResize() && (
        <Resizer header={header} fit={() => own.current && onFit(own.current)} />
      )}
    </span>
  );
}

const DIRECTIONS = { asc: "ascending", desc: "descending" };

/** A tooltip of these lines, leaving out those missing; none without any. */
function lines(...texts: (string | undefined)[]): string | undefined {
  return texts.filter(Boolean).join("\n") || undefined;
}

interface FilterProps {
  header: RefObject<HTMLSpanElement | null>;
  name: string; // the column's
  text: string | undefined; // what the filter is set to
  choices: ReactNode; // a menu, or a dialog
  menu: boolean; // whether they are a menu
}

/** The funnel opening a column's filter, below the whole header: lined up with its column. */
function Filter({ header, name, text, choices, menu }: FilterProps) {
  const Trigger = menu ? MenuTrigger : DialogTrigger;
  return (
    <Trigger>
      {/* Our own button, for its tooltip: React Aria's has none. */}
      <Pressable>
        <button
          type="button"
          className={styles.filter}
          aria-label={`Filter by ${name}`}
          title={text === undefined ? `Filter by ${name}` : `${name}: ${text}`}
        >
          <Funnel aria-hidden="true" />
        </button>
      </Pressable>
      <Popover className={popover.popover} triggerRef={header} placement="bottom start">
        {choices}
      </Popover>
    </Trigger>
  );
}

interface SortProps {
  column: Header["column"];
  description: string | undefined;
  children: ReactNode;
}

/** A column's label that sorts by it, or the other way round once it does. */
function SortButton({ column, description, children }: SortProps) {
  const sorted = column.getIsSorted();
  const Arrow = sorted === "desc" ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      className={`${styles.label} ${styles.sort}`}
      onClick={column.getToggleSortingHandler()}
      title={lines(
        description,
        sorted ? `Sorted by ${column.id}, ${DIRECTIONS[sorted]}` : `Sort by ${column.id}`,
      )}
    >
      {children}
      {sorted && <Arrow aria-hidden="true" />}
    </button>
  );
}

interface ChoicesProps {
  choices: Choice[];
  values: string[];
  set: (values: string[]) => void;
}

/** One of the choices, or all: choosing closes the menu. */
function OneChoice({ choices, values, set, name }: ChoicesProps & { name: string }) {
  const [chosen] = values;
  const entries: { value: string | undefined; label: string }[] = [
    { value: undefined, label: "all" },
    ...choices,
  ];
  // Items by their place: "all" has no value to be its key.
  const at = entries.findIndex(({ value }) => value === chosen);
  return (
    <Menu
      className={`${popover.menu} ${styles.menu} ${styles.choices}`}
      aria-label={`Filter by ${name}`}
      selectionMode="single"
      selectedKeys={at < 0 ? [] : [at]}
      onAction={(at) => {
        const value = entries[Number(at)]?.value;
        set(value === undefined ? [] : [value]);
      }}
    >
      {entries.map(({ value, label }, at) => (
        <MenuItem key={value ?? ""} id={at} className={styles.choice}>
          {label}
        </MenuItem>
      ))}
    </Menu>
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

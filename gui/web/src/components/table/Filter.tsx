import type { ComponentProps, RefObject } from "react";
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
import { type Choice, type ColumnFilterLook, toggled } from "./filters";
import styles from "./table.module.css";

/** The filter a column offers, with these values set: none for one only set from outside. */
export function offeredFilter(look: ColumnFilterLook | undefined, values: string[]) {
  return look?.linked && values.length === 0 ? undefined : look;
}

interface Props {
  name: string; // the column's
  look: ColumnFilterLook;
  values: string[]; // what it is set to; none for all
  choices: Choice[]; // what it offers; none while they load
  set: (values: string[]) => void;
  anchor?: RefObject<HTMLElement | null>; // what its choices open below, if not its button
  children: ComponentProps<typeof Pressable>["children"]; // its button: our own, for its tooltip, as React Aria's has none
}

/** A column's filter: its button opening its choices, a menu of one or a dialog of any. */
export function Filter({ name, look, values, choices, set, anchor, children }: Props) {
  const one = look.many === undefined;
  const Trigger = one ? MenuTrigger : DialogTrigger;
  return (
    <Trigger>
      <Pressable>{children}</Pressable>
      <Popover
        className={popover.popover}
        placement="bottom start"
        {...(anchor && { triggerRef: anchor })}
      >
        {one ? (
          <OneChoice choices={choices} values={values} set={set} name={name} />
        ) : (
          <Dialog className={popover.menu} aria-label={`Filter by ${name}`}>
            <ManyChoices choices={choices} values={values} set={set} />
          </Dialog>
        )}
      </Popover>
    </Trigger>
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
      className={`${popover.menu} ${styles.choices}`}
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

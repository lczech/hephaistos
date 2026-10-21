import { Search, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Button, SearchField as Field, Input } from "react-aria-components";
import { useKeyTarget } from "../views/keys";
import styles from "./SearchField.module.css";
import { TextIcon } from "./TextIcon";

interface SearchFieldProps {
  label: string;
  placeholder?: string;
  title?: string;
  className?: string;
  /** What is typed; each key changes it at once, while asking with it may wait (`useDebounced`). */
  value: string;
  onChange: (value: string) => void;
  /** Enter: to search at once. */
  onSubmit?: () => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  autoFocus?: boolean;
  /** Ctrl+F comes here: the field its View searches by. */
  byCtrlF?: boolean;
}

/** A field to type a search into, with a button and Escape to clear it. */
export function SearchField({
  label,
  placeholder,
  title,
  className,
  value,
  onChange,
  onSubmit,
  onKeyDown,
  autoFocus,
  byCtrlF,
}: SearchFieldProps) {
  const target = useKeyTarget(byCtrlF ? "search" : undefined);
  return (
    <Field
      className={[styles.field, className].filter(Boolean).join(" ")}
      aria-label={label}
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
      autoFocus={autoFocus}
    >
      <TextIcon icon={Search} />
      <Input ref={target} className={styles.input} placeholder={placeholder} title={title} />
      <Button className={styles.clear} aria-label="Clear">
        <X aria-hidden="true" />
      </Button>
    </Field>
  );
}

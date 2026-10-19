import { Search, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Button, SearchField as Field, Input } from "react-aria-components";
import styles from "./SearchField.module.css";

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
}: SearchFieldProps) {
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
      <Search className={styles.icon} aria-hidden="true" />
      <Input className={styles.input} placeholder={placeholder} title={title} />
      <Button className={styles.clear} aria-label="Clear">
        <X aria-hidden="true" />
      </Button>
    </Field>
  );
}

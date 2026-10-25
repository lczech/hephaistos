import { ArrowDown, ArrowUp, CaseSensitive, Regex, Search, WholeWord, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Input, TextField, Toolbar } from "react-aria-components";
import { useKeyTarget } from "../../views/keys";
import { IconButton } from "../IconButton";
import { TextIcon } from "../TextIcon";
import { Toggle } from "../ViewBar";
import styles from "./FindBar.module.css";
import type { FindQuery } from "./pattern";
import type { Finding } from "./useFind";

interface FindBarProps {
  label: string; // what it finds in: `Find in the diff`
  query: FindQuery;
  /** A key typed changes the text (`typed`), going on with the step back of the key before. */
  onChange: (query: FindQuery, typed: boolean) => void;
  /** Typing is done, e.g. on Enter or leaving the field: the next key is another step back. */
  onTypingEnd: () => void;
  finding: Finding | undefined;
  count: number; // matches found, where they count, e.g. shown
  current: number; // which of them
  onStep: (by: 1 | -1) => void;
  onClose: () => void;
}

const OPTIONS = [
  { key: "matchCase", icon: CaseSensitive, label: "Match case" },
  { key: "wholeWord", icon: WholeWord, label: "Match whole words" },
  { key: "regex", icon: Regex, label: "Use a regular expression" },
] as const;

/**
 * A row to find text in, below a View's bar: what is typed, how it is matched, which match of
 * how many, the next or the one before (Enter, Shift+Enter); Escape closes it. Ctrl+F comes to
 * its field.
 */
export function FindBar({
  label,
  query,
  onChange,
  onTypingEnd,
  finding,
  count,
  current,
  onStep,
  onClose,
}: FindBarProps) {
  const target = useKeyTarget("search");
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
    else if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      onStep(event.shiftKey ? -1 : 1);
      onTypingEnd();
    }
  };
  return (
    // Escape anywhere in it closes it, as its × does.
    <search
      className={styles.bar}
      aria-label="Find"
      onKeyDown={keys}
      data-busy={finding?.busy || undefined}
    >
      <TextField
        className={styles.field}
        aria-label={label}
        value={query.text}
        onChange={(text) => onChange({ ...query, text }, true)}
        onBlur={onTypingEnd}
      >
        <TextIcon icon={Search} />
        <Input ref={target} className={styles.input} placeholder="Find" autoFocus />
      </TextField>
      <Toolbar className={styles.tools} aria-label="How to find">
        {OPTIONS.map(({ key, icon, label }) => (
          <Toggle
            key={key}
            label={label}
            className={styles.option}
            on={query[key]}
            onChange={(on) => onChange({ ...query, [key]: on }, false)}
            ways={[{ icon, title: label }]}
          />
        ))}
      </Toolbar>
      <output className={styles.status} data-error={(finding && "error" in finding) || undefined}>
        {statusText(finding, current, count)}
      </output>
      <Toolbar className={styles.tools} aria-label="Matches">
        <IconButton
          icon={ArrowUp}
          label="Previous match"
          title="Previous match (Shift+Enter)"
          disabled={count === 0}
          onClick={() => onStep(-1)}
        />
        <IconButton
          icon={ArrowDown}
          label="Next match"
          title="Next match (Enter)"
          disabled={count === 0}
          onClick={() => onStep(1)}
        />
        <IconButton icon={X} label="Close" title="Close (Escape)" onClick={onClose} />
      </Toolbar>
    </search>
  );
}

/** Which match of how many, or why none: `3 of 12`, `No results`. */
function statusText(finding: Finding | undefined, current: number, count: number): string {
  if (finding === undefined) return "";
  if ("error" in finding) return finding.error;
  if (!("matches" in finding)) return "Searching…";
  if (count === 0) return "No results";
  const of = `${count.toLocaleString("en")}${finding.more ? "+" : ""}`;
  return `${(current + 1).toLocaleString("en")} of ${of}`;
}

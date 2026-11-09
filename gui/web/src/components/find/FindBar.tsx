import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  LoaderCircle,
  Regex,
  Search,
  WholeWord,
  X,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useEffectEvent, useState } from "react";
import { Input, TextField, Toolbar } from "react-aria-components";
import { atLeast, numberText } from "../../text";
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
  busy?: boolean; // looking also for what to find in, e.g. while the Server lists it
  more?: ReactNode; // options of the View's own, after the others: toggles
  note?: { text: string; title: string }; // after which match, e.g. why there may be more
}

export const TYPING_PAUSE = 150; // ms without a key before what is typed is looked for

const OPTIONS = [
  { key: "matchCase", icon: CaseSensitive, label: "Match case" },
  { key: "wholeWord", icon: WholeWord, label: "Match whole words" },
  { key: "regex", icon: Regex, label: "Use a regular expression" },
] as const;

/**
 * A row to find text in, below a View's bar: what is typed, how it is matched, which match of
 * how many, the next or the one before (Enter, Shift+Enter); Escape closes it. Ctrl+F comes to
 * its field. What is typed goes to the View once typing pauses (`TYPING_PAUSE`), or on Enter,
 * an option or leaving the field: each key draws the field alone, not all the View shows.
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
  busy = false,
  more,
  note,
}: FindBarProps) {
  const target = useKeyTarget("search");
  // Typed over the query's text then (`over`), or over the text passed on last (`passed`), as the
  // View may not have it yet: ours until the query is another, e.g. on going back.
  const [typed, setTyped] = useState<{ text: string; over: string; passed?: string }>();
  const ours = typed !== undefined && (typed.over === query.text || typed.passed === query.text);
  const text = ours ? typed.text : query.text;
  const pending = ours && typed.text !== query.text ? typed.text : undefined;
  const passOn = useEffectEvent(() => {
    if (pending === undefined) return;
    onChange({ ...query, text: pending }, true);
    setTyped({ text: pending, over: query.text, passed: pending });
  });
  useEffect(() => {
    if (pending === undefined) return;
    const timer = setTimeout(passOn, TYPING_PAUSE);
    return () => clearTimeout(timer);
  }, [pending]);
  const endTyping = () => {
    passOn();
    onTypingEnd();
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
    else if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      if (pending === undefined) onStep(event.shiftKey ? -1 : 1);
      endTyping(); // a search not yet looked for starts at its first match
    }
  };
  return (
    // Escape anywhere in it closes it, as its × does.
    <search
      className={styles.bar}
      aria-label="Find"
      onKeyDown={keys}
      data-busy={busy || finding?.busy || undefined}
    >
      <TextField
        className={styles.field}
        aria-label={label}
        value={text}
        onChange={(next) => setTyped((was) => ({ ...was, text: next, over: query.text }))}
        onBlur={endTyping}
      >
        <TextIcon
          icon={busy || finding?.busy ? LoaderCircle : Search}
          className={styles.searching}
        />
        <Input
          ref={target}
          className={styles.input}
          placeholder="Find"
          spellCheck={false}
          autoFocus
        />
      </TextField>
      <Toolbar className={styles.tools} aria-label="How to find">
        {OPTIONS.map(({ key, icon, label }) => (
          <Toggle
            key={key}
            label={label}
            className={styles.option}
            on={query[key]}
            onChange={(on) => onChange({ ...query, text, [key]: on }, false)}
            ways={[{ icon, title: label }]}
          />
        ))}
        {more}
      </Toolbar>
      <output
        className={styles.status}
        data-error={(finding && "error" in finding) || undefined}
        title={note?.title}
      >
        {statusText(finding, current, count)}
        {note && finding && "matches" in finding && `; ${note.text}`}
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
  return `${numberText(current + 1)} of ${atLeast(count, finding.more)}`;
}

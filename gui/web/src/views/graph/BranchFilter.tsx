import { ChevronDown } from "lucide-react";
import { Dialog, DialogTrigger, Popover, Pressable } from "react-aria-components";
import controls from "../../components/controls.module.css";
import list from "../../components/list/list.module.css";
import popover from "../../components/popover.module.css";
import { REF_ICONS } from "../../icons";
import { numberText } from "../../text";
import styles from "./BranchFilter.module.css";

/** Which branches a Graph walks: all local ones, or those checked out and the default one. */
export type Walked = "local" | "worktrees";

interface Props {
  walked: Walked;
  branches: string[]; // those this mode walks, in the order to list them
  hidden: string[];
  onChange: (walked: Walked, hidden: string[]) => void;
}

/** What the filter's button says: `All local branches`, `Worktrees only, 2 hidden`. */
export function filterText(walked: Walked, hidden: number): string {
  const which = walked === "local" ? "All local branches" : "Worktrees only";
  return hidden > 0 ? `${which}, ${numberText(hidden)} hidden` : which;
}

/**
 * Which branches the Graph shows: all local ones, or only those of its Checkouts with the default
 * one; and of those, each shown or hidden by its checkbox, or only one of them, or all again.
 * Hidden ones are kept by name, so a branch made later shows.
 */
export function BranchFilter({ walked, branches, hidden, onChange }: Props) {
  const Icon = REF_ICONS.branch;
  const set = (next: string[]) => onChange(walked, next);
  return (
    <DialogTrigger>
      {/* Our own button, for its tooltip: React Aria's has none. */}
      <Pressable>
        <button
          type="button"
          className={controls.pick}
          title="Which branches to show, and where their commits come from"
        >
          <Icon className={controls.pickIcon} aria-hidden="true" />
          {filterText(walked, hidden.length)}
          <ChevronDown className={controls.pickIcon} aria-hidden="true" />
        </button>
      </Pressable>
      <Popover className={popover.popover} placement="bottom start">
        <Dialog className={popover.menu} aria-label="Branches shown">
          <fieldset className={styles.walked}>
            <legend className={styles.legend}>Walk from</legend>
            {(
              [
                ["local", "All local branches"],
                ["worktrees", "Branches of worktrees, and the default branch"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className={list.tick}>
                <input
                  type="radio"
                  name="walked"
                  checked={walked === value}
                  onChange={() => onChange(value, hidden)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <hr className={popover.separator} />
          <button
            type="button"
            className={list.choice}
            disabled={hidden.length === 0}
            onClick={() => set([])}
          >
            Show all
          </button>
          <ul className={list.choices}>
            {branches.map((name) => (
              <li key={name}>
                <span className={list.entry}>
                  <label className={list.tick}>
                    <input
                      type="checkbox"
                      checked={!hidden.includes(name)}
                      onChange={() =>
                        set(
                          hidden.includes(name)
                            ? hidden.filter((each) => each !== name)
                            : [...hidden, name],
                        )
                      }
                    />
                    {name}
                  </label>
                  <button
                    type="button"
                    className={list.only}
                    aria-label={`Only ${name}`}
                    onClick={() => set(branches.filter((each) => each !== name))}
                  >
                    only
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

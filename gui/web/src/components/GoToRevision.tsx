import { ChevronDown, LoaderCircle, LocateFixed, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { DialogTrigger, Pressable } from "react-aria-components";
import type { Checkout } from "../views/checkout";
import controls from "./controls.module.css";
import {
  type CommitsFrom,
  type KnownRefs,
  type Picked,
  type PickerTab,
  RevisionPopover,
} from "./GitRevisionPicker";
import styles from "./GoToRevision.module.css";
import text from "./text.module.css";
import turning from "./turning.module.css";

const TABS: PickerTab[] = ["branches", "tags", "commits"];

interface Props {
  checkout: Checkout;
  commitsFrom: CommitsFrom;
  known?: KnownRefs;
  onPick: (picked: Picked) => void;
  going?: { what: string; far: string } | undefined; // to what was picked, once it takes a while,
  // and how far it got, e.g. `Loading towards main`, `3 commits so far`
  missed?: string | undefined; // why the one picked last is not shown
  onStop: () => void;
}

/**
 * A button that goes to a branch, tag or commit, picked from the list of a picker of Revisions
 * (`RevisionPopover`): local branches and tags, and commits searched for in `commitsFrom`, or
 * what git resolves typed. It holds nothing picked: it always says "Go to…". While going takes
 * a while, its icon turns and a click on it stops; where what was picked is not shown, it says so.
 */
export function GoToRevision({
  checkout,
  commitsFrom,
  known,
  onPick,
  going,
  missed,
  onStop,
}: Props) {
  const [open, setOpen] = useState(false);
  const said = going?.what; // to screen readers once, not again for each page that comes
  let Icon = LocateFixed;
  let iconLook = "";
  let title = "Go to a branch, tag or commit, loading older commits until it shows";
  if (going !== undefined) {
    Icon = LoaderCircle;
    iconLook = turning.turning ?? "";
    title = `${going.what}: ${going.far}; a click or Escape stops`;
  } else if (missed !== undefined) {
    Icon = TriangleAlert;
    iconLook = styles.missed ?? "";
    title = `${missed}; pick another`;
  }
  return (
    <>
      <DialogTrigger
        isOpen={open}
        onOpenChange={(opening) => {
          if (opening && going !== undefined)
            onStop(); // a click while going stops it
          else setOpen(opening);
        }}
      >
        {/* Our own button, for its tooltip: React Aria's has none. */}
        <Pressable>
          <button
            type="button"
            className={controls.pick}
            title={title}
            aria-label={
              going === undefined
                ? "Go to a branch, tag or commit"
                : `Stop ${going.what.toLowerCase()}`
            }
            data-busy={going !== undefined || undefined}
            data-missed={missed !== undefined || undefined}
          >
            <Icon className={`${controls.pickIcon} ${iconLook}`} aria-hidden="true" />
            Go to…
            <ChevronDown className={controls.pickIcon} aria-hidden="true" />
          </button>
        </Pressable>
        <RevisionPopover
          checkout={checkout}
          label="Branch, tag or commit to go to"
          rows={[]}
          tabs={TABS}
          commitsFrom={commitsFrom}
          withRemotes={false}
          known={known}
          onPick={(picked) => {
            onPick(picked);
            setOpen(false);
          }}
        />
      </DialogTrigger>
      <span className={text.unseen} aria-live="polite">
        {said ?? missed}
      </span>
    </>
  );
}

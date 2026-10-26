import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Menu, MenuItem, MenuTrigger, Popover, Pressable } from "react-aria-components";
import controls from "./controls.module.css";
import popover from "./popover.module.css";

/** One of a picker's choices: its key, and what it says. */
export interface Choosable {
  id: string;
  text: string;
}

interface Props {
  label: string; // what it picks: its menu's name, and its tooltip unless `title` says more
  title?: string;
  picks: Choosable[];
  picked: string | undefined; // the one checked, if any
  onPick: (id: string) => void;
  placement?: "bottom start" | "bottom end";
  children: ReactNode; // what its button says: the one picked, as it reads there
}

/**
 * A field opening a menu to choose one from, the one picked checked: our own, so that it looks
 * as the GUI does, dark too, which the browser's `select` can't.
 */
export function Picker({ label, title, picks, picked, onPick, placement, children }: Props) {
  return (
    <MenuTrigger>
      {/* Our own button, for its tooltip: React Aria's has none. */}
      <Pressable>
        <button type="button" className={controls.pick} title={title ?? label}>
          {children}
          <ChevronDown className={controls.pickIcon} aria-hidden="true" />
        </button>
      </Pressable>
      <Popover className={popover.popover} placement={placement ?? "bottom start"}>
        <PickMenu label={label} picks={picks} picked={picked} onPick={onPick} />
      </Popover>
    </MenuTrigger>
  );
}

type MenuProps = Pick<Props, "label" | "picks" | "picked" | "onPick">;

/** A picker's menu, for a trigger of another look too: e.g. a filter's funnel. */
export function PickMenu({ label, picks, picked, onPick }: MenuProps) {
  return (
    <Menu
      className={popover.menu}
      aria-label={label}
      selectionMode="single"
      selectedKeys={picked === undefined ? [] : [picked]}
      onAction={(id) => onPick(String(id))}
    >
      {picks.map(({ id, text }) => (
        <MenuItem key={id} id={id} className={controls.item}>
          {text}
        </MenuItem>
      ))}
    </Menu>
  );
}

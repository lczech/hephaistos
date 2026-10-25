import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, Ref } from "react";
import controls from "./controls.module.css";

interface Props
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "title" | "type"> {
  icon: LucideIcon;
  label: string; // its name, and its tooltip unless `title` says more
  title?: string; // at length, if more than its label
  ref?: Ref<HTMLButtonElement>;
}

/**
 * An icon that does something: named by its label, which its tooltip says too (our own button
 * for that: React Aria's has none). It only acts: a toggle is a `Toggle`. Its class may add where
 * it sits.
 */
export function IconButton({ icon: Icon, label, title, className, ...props }: Props) {
  return (
    <button
      type="button"
      className={className ? `${controls.icon} ${className}` : controls.icon}
      aria-label={label}
      title={title ?? label}
      {...props}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

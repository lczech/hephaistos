import type { LucideIcon } from "lucide-react";
import styles from "./TextIcon.module.css";

interface Props {
  icon: LucideIcon;
  className?: string; // room and colour of its own; its size and place are this one's
  label?: string; // what it says, where the text beside it doesn't
}

/** An icon beside text, lined up with its capitals, in a line of text or a row alike. */
export function TextIcon({ icon: Icon, className, label }: Props) {
  return (
    <Icon
      className={className ? `${styles.icon} ${className}` : styles.icon}
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
    />
  );
}

import { TextIcon } from "../components/TextIcon";
import { KINDS } from "../views/kinds";
import styles from "./layout.module.css";

interface Props {
  open: (kind: string) => void;
  suggested?: boolean; // only the suggested kinds
  menu?: string; // the popover the list is in, closed on choosing
}

/** The kinds of View to choose from. */
export function ViewList({ open, suggested, menu }: Props) {
  const kinds = Object.entries(KINDS).filter(([, kind]) => !suggested || kind.suggested);
  return (
    <ul className={styles.views}>
      {kinds.map(([name, { name: title, icon: Icon }]) => (
        <li key={name}>
          <button
            type="button"
            className={styles.choice}
            popoverTarget={menu}
            popoverTargetAction={menu === undefined ? undefined : "hide"}
            onClick={() => open(name)}
          >
            <TextIcon icon={Icon} className={styles.choiceIcon} />
            {title}
          </button>
        </li>
      ))}
    </ul>
  );
}

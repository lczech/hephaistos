import type { ReactNode } from "react";
import styles from "./table.module.css";

interface Props {
  fields: [string, ReactNode][]; // labels and their texts, or links
  title?: string; // over them, which then go in a little
}

/** Labelled texts, as in a row's details. */
export function Fields({ fields, title }: Props) {
  return (
    <>
      {title !== undefined && <p className={styles.title}>{title}</p>}
      <dl className={styles.fields} data-titled={title !== undefined || undefined}>
        {fields.map(([label, text]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** Something other than fields in a row's details, under a title as titled fields are. */
export function Titled({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <p className={styles.title}>{title}</p>
      <div className={styles.titled}>{children}</div>
    </>
  );
}

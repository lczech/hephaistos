import styles from "./table.module.css";

interface Props {
  fields: [string, string][]; // labels and their texts
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

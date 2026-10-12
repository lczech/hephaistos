import styles from "./TokenHint.module.css";

/** What to do without the token: open the link the CLI prints. */
export function TokenHint() {
  return (
    <main className={styles.hint}>
      <h1 className={styles.title}>hephaistos</h1>
      <p>This page needs the token of this Machine's Server. Open the link this prints:</p>
      <pre className={styles.command}>hephaistos daemon token --url</pre>
    </main>
  );
}

import { useConfig, useInfo } from "../../api/queries";
import styles from "./ConfigView.module.css";
import { appliedText, sourceRows, sourceText, valueText } from "./configText";

/** Text with its `quoted` parts as code, as `defaults.toml`'s comments quote them. */
function Described({ text }: { text: string }) {
  // Splitting on a captured group puts the quoted parts at odd places.
  return text.split(/`([^`]+)`/).map((part, i) =>
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one text, in its order
    i % 2 === 1 ? <code key={i}>{part}</code> : part,
  );
}

/** The settings the Daemon finds, and where each comes from, as `hephaistos config show`. */
export function ConfigView() {
  const config = useConfig();
  const home = useInfo().data?.home;
  if (config.data === undefined) {
    const text = config.isError ? `No answer: ${config.error.message}` : "Asking for the settings…";
    return (
      <section className={styles.view}>
        <p className={styles.quiet}>{text}</p>
      </section>
    );
  }
  return (
    <section className={styles.view} data-stale={config.isError || undefined}>
      <div className={styles.settings}>
        {config.data.settings.map((setting) => {
          const applied = appliedText(setting);
          const preset = setting.source === "default";
          return (
            <div key={setting.key} className={styles.setting} data-tone={applied && "warning"}>
              <span className={styles.key}>{setting.key}</span>
              <span data-preset={preset || undefined}>
                {valueText(setting.value, setting.type)}
              </span>
              <span className={styles.quiet} title={setting.source}>
                {sourceText(setting.source)}
              </span>
              <span className={styles.description}>
                <Described
                  text={
                    applied === undefined
                      ? setting.description
                      : `${applied} ${setting.description}`
                  }
                />
              </span>
            </div>
          );
        })}
      </div>
      <p className={styles.host}>Host: {config.data.host}</p>
      <div className={styles.sources}>
        {sourceRows(config.data, home).map(({ source, state, tone, error }) => (
          <div key={source} className={styles.source} data-tone={tone}>
            <span>{source}</span>
            <span>{state}</span>
            {error !== undefined && <span className={styles.description}>{error}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

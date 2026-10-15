import type { ForgePage } from "../forges";
import styles from "./ForgeLink.module.css";

/** A link to a remote's page on its forge, in a new browser tab: its logo, or its URL. */
export function ForgeLink({ page, text }: { page: ForgePage; text?: boolean }) {
  return (
    <a
      className={text ? undefined : styles.icon}
      href={page.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${page.url} (${page.forge})`}
      aria-label={text ? undefined : `${page.url} on ${page.forge}`}
    >
      {text ? (
        page.url
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={page.icon.path} />
        </svg>
      )}
    </a>
  );
}

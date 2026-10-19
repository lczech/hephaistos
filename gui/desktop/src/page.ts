// The page the Desktop shows while it can't show the GUI: built in, as no Server serves it.

import { RETRY, type Waiting } from "./connecting.js";

const STYLE = `
  :root { color-scheme: light dark; font: 15px/1.5 system-ui, sans-serif; }
  body { margin: 0; display: grid; place-items: center; min-height: 100vh; background: #ffffff; }
  @media (prefers-color-scheme: dark) { body { background: #1e1e1e; } } /* as the GUI's */
  main { max-width: 36rem; padding: 0 16px; }
  h1 { font-size: 1.25rem; font-weight: 600; }
  p { opacity: 0.8; }
`;

function escaped(text: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  };
  return text.replace(/[&<>"]/g, (character) => entities[character] ?? character);
}

/** Text with our messages' `commands` shown as code. */
function withCode(text: string): string {
  return escaped(text).replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** One of our messages as a sentence: they start in lower case, after `error: `. */
function sentence(text: string): string {
  const capital = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

/** The page as a URL to load: no files, and nothing that runs. */
export function waitingPage(waiting: Waiting): string {
  const body =
    waiting.state === "starting"
      ? "<h1>Starting the Daemon…</h1>"
      : `<h1>Can't reach the Daemon</h1><p>${withCode(sentence(waiting.reason))}</p>` +
        `<p>Trying again every ${RETRY / 1000} s; Press Ctrl+R to try now; that also starts the Daemon if needed.</p>`;
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">` +
    `<title>hephaistos</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

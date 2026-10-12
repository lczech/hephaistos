// The token for this Machine's Server. A link from `hephaistos daemon token --url` brings it in
// its fragment, which browsers never send; it is kept in this origin's storage.

const KEY = "hephaistos.token";

type Listener = () => void;
const listeners = new Set<Listener>();
let current: string | null = read();

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // storage may be off, e.g. in a private window
  }
}

function write(token: string | null): void {
  current = token;
  try {
    if (token === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, token);
  } catch {
    // kept for this page only
  }
  for (const listener of listeners) listener();
}

/** Takes the token out of the address bar, if a link brought one, so that history never has it. */
export function takeTokenFromUrl(location: Location = window.location): void {
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  if (token === null) return;
  window.history.replaceState(null, "", location.pathname + location.search);
  if (token !== "") write(token);
}

export function token(): string | null {
  return current;
}

/** Forgets a token the Server refused, e.g. after `daemon token --renew`. */
export function forgetToken(): void {
  if (current !== null) write(null);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

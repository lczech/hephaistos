/** What a View shows: its kind and parameters, e.g. `events?repository=0192…`. */
export interface Address {
  kind: string;
  params: Record<string, string>;
}

const INSTANCE = "~"; // a Panel's ID: the address, then `~2` for a second Panel showing it

/** An address as text, its parameters sorted, so one View has exactly one. */
export function addressText({ kind, params }: Address): string {
  const query = new URLSearchParams(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)));
  return query.size === 0 ? kind : `${kind}?${query}`;
}

export function parseAddress(text: string): Address | null {
  const [kind = "", query = ""] = text.split(/\?(.*)/s);
  if (!/^[a-z][a-z-]*$/.test(kind)) return null;
  return { kind, params: Object.fromEntries(new URLSearchParams(query)) };
}

/** The ID of a Panel showing this address; a second Panel showing it gets instance 2. */
export function panelId(address: Address, instance = 1): string {
  const text = addressText(address);
  return instance === 1 ? text : `${text}${INSTANCE}${instance}`;
}

export function panelAddress(id: string): Address | null {
  return parseAddress(id.replace(new RegExp(`${INSTANCE}\\d+$`), ""));
}

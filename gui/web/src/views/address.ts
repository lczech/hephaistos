/** What a View shows: its kind and parameters, e.g. `events?repository=0192…`. */
export interface Address {
  kind: string;
  params: Record<string, string>;
}

const KIND = /^[a-z][a-z-]*$/;

/** An address as text, its parameters sorted, so one View has exactly one. */
export function addressText({ kind, params }: Address): string {
  const query = new URLSearchParams(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)));
  return query.size === 0 ? kind : `${kind}?${query}`;
}

export function parseAddress(text: string): Address | null {
  const [kind = "", query = ""] = text.split(/\?(.*)/s);
  if (!KIND.test(kind)) return null;
  return { kind, params: Object.fromEntries(new URLSearchParams(query)) };
}

/** The address in something saved, e.g. a Panel's parameters, if it holds one. */
export function asAddress(value: unknown): Address | null {
  if (typeof value !== "object" || value === null) return null;
  const { kind, params } = value as Record<string, unknown>;
  if (typeof kind !== "string" || !KIND.test(kind)) return null;
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  if (!Object.values(params).every((param) => typeof param === "string")) return null;
  return { kind, params: params as Address["params"] };
}

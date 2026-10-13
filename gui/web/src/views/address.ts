/** A View's parameters by name; one with several values is a list. */
export type Params = Record<string, string | string[]>;

/** What a View shows: its kind and parameters, e.g. `events?repository=0192…`. */
export interface Address {
  kind: string;
  params: Params;
}

const KIND = /^[a-z][a-z-]*$/;

/** A parameter's values, however many it has. */
export function paramValues(param: string | string[] | undefined): string[] {
  if (param === undefined) return [];
  return typeof param === "string" ? [param] : param;
}

/** These parameters with one set to these values; with none, it is left out. */
export function withParam(params: Params, name: string, values: string[]): Params {
  const { [name]: _, ...others } = params;
  if (values.length === 0) return others;
  return { ...others, [name]: values.length === 1 ? (values[0] as string) : values };
}

/**
 * An address as text, its parameters and their values sorted, so one View has exactly one:
 * `events?kind=clone&kind=worktree&since=1d`.
 */
export function addressText({ kind, params }: Address): string {
  const query = new URLSearchParams();
  for (const name of Object.keys(params).sort()) {
    for (const value of [...paramValues(params[name])].sort()) query.append(name, value);
  }
  return query.size === 0 ? kind : `${kind}?${query}`;
}

export function parseAddress(text: string): Address | null {
  const [kind = "", query = ""] = text.split(/\?(.*)/s);
  if (!KIND.test(kind)) return null;
  let params: Params = {};
  const read = new URLSearchParams(query);
  for (const name of new Set(read.keys())) params = withParam(params, name, read.getAll(name));
  return { kind, params };
}

function isParam(value: unknown): value is string | string[] {
  if (typeof value === "string") return true;
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** The address in something saved, e.g. a Panel's parameters, if it holds one. */
export function asAddress(value: unknown): Address | null {
  if (typeof value !== "object" || value === null) return null;
  const { kind, params } = value as Record<string, unknown>;
  if (typeof kind !== "string" || !KIND.test(kind)) return null;
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  if (!Object.values(params).every(isParam)) return null;
  return { kind, params: params as Params };
}

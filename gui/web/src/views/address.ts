/** A View's parameters by name; one with several values is a list. */
export type Params = Record<string, string | string[]>;

/**
 * Where a View is, as a URL has it: what it shows, its kind and parameters (the query), e.g.
 * `events?repository=0192…`; and how it is looked at, its fragment, e.g. searched or sorted:
 * `diff?…#find=beta`. Addresses differing only in their fragments name the same View.
 */
export interface Address {
  kind: string;
  params: Params;
  fragment?: Params; // none if empty
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

/** Parameters as a URL's query or fragment has them, sorted, each value encoded. */
function paramsText(params: Params): string {
  const query = new URLSearchParams();
  for (const name of Object.keys(params).sort()) {
    for (const value of [...paramValues(params[name])].sort()) query.append(name, value);
  }
  return query.toString();
}

function paramsOf(text: string): Params {
  let params: Params = {};
  const read = new URLSearchParams(text);
  for (const name of new Set(read.keys())) params = withParam(params, name, read.getAll(name));
  return params;
}

/**
 * An address as text, its parameters and their values sorted, so one View has exactly one:
 * `events?kind=clone&kind=worktree&since=1d`, `diff?…#find=beta`.
 */
export function addressText({ kind, params, fragment = {} }: Address): string {
  const query = paramsText(params);
  const hash = paramsText(fragment);
  return `${kind}${query && `?${query}`}${hash && `#${hash}`}`;
}

/** The View an address names, however it is looked at: its text without the fragment. */
export function viewKey({ kind, params }: Address): string {
  return addressText({ kind, params });
}

export function parseAddress(text: string): Address | null {
  const [named = "", hash] = text.split(/#(.*)/s);
  const [kind = "", query = ""] = named.split(/\?(.*)/s);
  if (!KIND.test(kind)) return null;
  const fragment = hash === undefined ? {} : paramsOf(hash);
  return { kind, params: paramsOf(query), ...(Object.keys(fragment).length > 0 && { fragment }) };
}

function isParam(value: unknown): value is string | string[] {
  if (typeof value === "string") return true;
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isParams(value: unknown): value is Params {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(isParam);
}

/** The address in something saved, e.g. a Panel's parameters, if it holds one. */
export function asAddress(value: unknown): Address | null {
  if (typeof value !== "object" || value === null) return null;
  const { kind, params, fragment } = value as Record<string, unknown>;
  if (typeof kind !== "string" || !KIND.test(kind) || !isParams(params)) return null;
  if (fragment === undefined) return { kind, params };
  return isParams(fragment) ? { kind, params, fragment } : null;
}

// Whether this GUI fits the API of the Daemon it talks to.

export interface ApiVersion {
  major: number;
  minor: number;
}

declare const __API_VERSION__: string; // set by vite.config.ts

/** The API version this GUI was built for. */
export function builtFor(text: string = __API_VERSION__): ApiVersion {
  const [major = 0, minor = 0] = text.split(".").map(Number);
  return { major, minor };
}

export interface Fit {
  usable: boolean; // false: different majors, nothing can be trusted to work
  hint: string | null; // what to do about a difference
}

const RESTART = "restart it: `hephaistos daemon restart`";
const REBUILD = "rebuild the GUI in the checkout: `uv run npm --prefix gui run build`, then reload";

/**
 * How the GUI fits the running API: a newer minor only adds; before 1.0, any change may break.
 */
export function apiFit(built: ApiVersion, running: ApiVersion): Fit {
  const shown = (version: ApiVersion) => `${version.major}.${version.minor}`;
  const same = built.major === running.major && built.minor === running.minor;
  if (same || (built.major === running.major && built.major > 0 && running.minor > built.minor)) {
    return { usable: true, hint: null };
  }
  const daemonOlder =
    running.major < built.major || (running.major === built.major && running.minor < built.minor);
  const hint =
    `This GUI is built for API ${shown(built)}; the Daemon runs ${shown(running)}: ` +
    (daemonOlder ? RESTART : REBUILD);
  return { usable: built.major === running.major, hint };
}

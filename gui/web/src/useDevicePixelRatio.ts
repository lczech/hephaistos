import { useSyncExternalStore } from "react";

/** Device pixels per CSS pixel now: 1 where the browser cannot say. */
function ratio(): number {
  return globalThis.devicePixelRatio || 1;
}

// A media query matches one ratio only, so each change listens anew for the next.
function onRatioChange(changed: () => void): () => void {
  let query: MediaQueryList | undefined;
  const listen = () => {
    query = globalThis.matchMedia?.(`(resolution: ${ratio()}dppx)`);
    query?.addEventListener("change", change, { once: true });
  };
  const change = () => {
    listen();
    changed();
  };
  listen();
  return () => query?.removeEventListener("change", change);
}

/** Device pixels per CSS pixel, followed as they change, e.g. with the zoom of the window or on
 * another screen. */
export function useDevicePixelRatio(): number {
  return useSyncExternalStore(onRatioChange, ratio);
}

import { useEffect, useState } from "react";

/**
 * A value that follows another once that stopped changing for `delay` ms, e.g. a search typed,
 * so that asking with it waits for typing to pause; and a way to follow at once.
 */
export function useDebounced<T>(value: T, delay: number): [T, () => void] {
  const [followed, setFollowed] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setFollowed(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  const now = () => setFollowed(value);
  return [followed, now];
}

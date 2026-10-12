import { useEffect, useState } from "react";

/** The current time, updated every `interval` ms, so that ages shown keep counting. */
export function useNow(interval = 1_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

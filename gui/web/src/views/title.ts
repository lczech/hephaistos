import { useEffect } from "react";

/** Names a View's tab once its title is known, and again as it changes (`ViewProps.setTitle`). */
export function useTitle(setTitle: (title: string) => void, title: string | undefined): void {
  useEffect(() => {
    if (title !== undefined) setTitle(title);
  }, [setTitle, title]);
}

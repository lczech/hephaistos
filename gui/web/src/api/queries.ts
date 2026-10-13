// What the GUI asks the Server, kept fresh by polling while the page is visible.

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, unwrap } from "./client";

export const POLL_INTERVAL = 5_000;
export const FOCUS_GAP = 10_000; // between passes asked for on gaining focus

export function useInfo() {
  return useQuery({
    queryKey: ["info"],
    queryFn: async () => unwrap(await api.GET("/api/info")),
    refetchInterval: POLL_INTERVAL,
  });
}

export function useDaemon() {
  return useQuery({
    queryKey: ["daemon"],
    queryFn: async () => unwrap(await api.GET("/api/daemon")),
    refetchInterval: POLL_INTERVAL,
  });
}

export function useMachines() {
  return useQuery({
    queryKey: ["machines"],
    queryFn: async () => unwrap(await api.GET("/api/machines")),
    refetchInterval: 60_000, // Machines come and go rarely
  });
}

export const EVENTS_PAGE = 50;

/** Events, newest first; each further page goes back from the oldest so far. */
export function useEvents() {
  return useInfiniteQuery({
    queryKey: ["events"],
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET("/api/events", {
          params: { query: { limit: EVENTS_PAGE, before: pageParam } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.length < EVENTS_PAGE ? undefined : page.at(-1)?.id),
    refetchInterval: POLL_INTERVAL,
  });
}

/** Has the Watcher pass; what it found, the other queries show. */
export async function observe(): Promise<void> {
  const answer = await api.POST("/api/observe");
  if (!answer.response.ok) unwrap(answer);
}

export function useObserve() {
  const client = useQueryClient();
  return useMutation({ mutationFn: observe, onSettled: () => client.invalidateQueries() });
}

/** Asks for a pass when the page opens or gains focus, at most every FOCUS_GAP. */
export function useObserveOnFocus(): void {
  const client = useQueryClient();
  useEffect(() => {
    let last = Number.NEGATIVE_INFINITY;
    const onFocus = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < FOCUS_GAP) return;
      last = Date.now();
      // A failed pass shows in the Daemon's status, like any other.
      void observe()
        .catch(() => undefined)
        .then(() => client.invalidateQueries());
    };
    onFocus();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [client]);
}

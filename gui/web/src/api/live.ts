// The live connection to this Machine's Server: it hints at what changed, and the queries that
// show it are asked again. On connecting, everything is, as hints may have been missed.

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { forgetToken, token } from "../token";
import type { Schemas } from "./client";
import { KEYS, type KeyName, observe } from "./queries";

export type Hint = Schemas["LiveHintsJson"]["hints"][number];

/** What each hint has asked again. */
export const HINTED: Record<Hint, KeyName[]> = {
  data: ["repositories", "machines", "events", "db", "changes", "diff"],
  daemon: ["daemon"],
  log: ["log"],
};

/** Asked again when the page gains focus: what changes by hand, which no hint covers. */
export const ON_FOCUS: KeyName[] = ["config", "daemon", "changes", "diff"];

/** Asked again only on connecting, as everything is: what changes only with the Daemon. */
export const ON_CONNECT: KeyName[] = ["info", "eventKinds"];

export const SILENCE = 25_000; // without any message, the connection counts as lost
export const FIRST_DELAY = 1_000; // before reconnecting; doubles with each failure
export const LAST_DELAY = 30_000;
export const FOCUS_GAP = 10_000; // between passes asked for on gaining focus
const WATCH_INTERVAL = 1_000;
const REFUSED = 4401; // the Server's close code for a wrong or renewed token

export type Connection =
  | { state: "connecting" } // never connected yet
  | { state: "live"; since: number }
  | { state: "disconnected"; since: number; retryAt: number };

let connection: Connection = { state: "connecting" };
const listeners = new Set<() => void>();

function set(next: Connection): void {
  connection = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The live connection's state, for showing it. */
export function useConnection(): Connection {
  return useSyncExternalStore(subscribe, () => connection);
}

function invalidate(client: QueryClient, names: KeyName[]): void {
  for (const name of names) void client.invalidateQueries({ queryKey: KEYS[name] });
}

/** One live connection: reconnects until stopped, ever later after each failure. */
class LiveConnection {
  private socket: WebSocket | null = null;
  private delay = FIRST_DELAY;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private watch: ReturnType<typeof setInterval> | undefined;
  private heard = 0; // when a message last arrived

  constructor(private readonly client: QueryClient) {}

  start(): void {
    set({ state: "connecting" });
    this.watch = setInterval(() => this.checkSilence(), WATCH_INTERVAL);
    this.connect();
  }

  stop(): void {
    clearTimeout(this.retry);
    clearInterval(this.watch);
    this.drop();
  }

  /** Tries again at once, if disconnected; e.g. as the page gains focus after a suspend. */
  reconnectNow(): void {
    if (connection.state !== "disconnected") return;
    clearTimeout(this.retry);
    this.delay = FIRST_DELAY;
    this.connect();
  }

  private connect(): void {
    const url = new URL("/api/live", window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    this.socket = socket;
    const sent = token();
    socket.onopen = () => {
      socket.send(JSON.stringify({ token: sent }));
      this.heard = Date.now();
      this.delay = FIRST_DELAY;
      set({ state: "live", since: Date.now() });
      void this.client.invalidateQueries();
    };
    socket.onmessage = (event: MessageEvent) => {
      this.heard = Date.now();
      const message = JSON.parse(String(event.data)) as Partial<Schemas["LiveHintsJson"]>;
      for (const hint of message.hints ?? []) invalidate(this.client, HINTED[hint] ?? []);
    };
    socket.onclose = (event: CloseEvent) => {
      if (socket !== this.socket) return;
      this.socket = null;
      // Refused: the page then shows how to get the token.
      if (event.code === REFUSED) forgetToken(sent);
      else this.lost();
    };
  }

  /** Closes the socket without waiting for its handshake, which a stuck one never finishes. */
  private drop(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket === null) return;
    socket.onopen = socket.onmessage = socket.onclose = null;
    socket.close();
  }

  private checkSilence(): void {
    if (connection.state === "live" && Date.now() - this.heard > SILENCE) {
      this.drop();
      this.lost();
    }
  }

  private lost(): void {
    const since = connection.state === "disconnected" ? connection.since : Date.now();
    set({ state: "disconnected", since, retryAt: Date.now() + this.delay });
    this.retry = setTimeout(() => this.connect(), this.delay);
    this.delay = Math.min(this.delay * 2, LAST_DELAY);
  }
}

/**
 * Keeps the live connection while mounted, and acts on the page gaining focus: asks for a pass
 * (at most every FOCUS_GAP), asks again for what no hint covers, and reconnects at once.
 */
export function useLiveUpdates(): void {
  const client = useQueryClient();
  useEffect(() => {
    const live = new LiveConnection(client);
    live.start();
    let lastPass = Number.NEGATIVE_INFINITY;
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      live.reconnectNow();
      if (Date.now() - lastPass < FOCUS_GAP) return;
      lastPass = Date.now();
      invalidate(client, ON_FOCUS);
      // A failed pass shows in the Daemon's status, like any other.
      void observe().catch(() => undefined);
    };
    onFocus();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      live.stop();
    };
  }, [client]);
}

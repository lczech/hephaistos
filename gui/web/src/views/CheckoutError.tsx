// Why a View of a Checkout can't show it: a note above what it showed before, or, once the
// Checkout is gone, in place of all of it. Both link to the Events that say what happened.

import { type ReactNode, useState } from "react";
import { ApiError, type Schemas } from "../api/client";
import type { Address } from "./address";
import styles from "./CheckoutError.module.css";
import { ViewLink } from "./ViewLink";

/** A query's result, as far as `useKeptError` reads it. */
interface Result {
  data: unknown;
  error: Error | null;
  isFetching: boolean;
  isPlaceholderData: boolean;
}

/**
 * A query's error, kept while the same query is asked for again with no data to show:
 * TanStack Query clears the error then, and the View would show itself loading between two
 * errors, e.g. each time the window gains focus.
 */
export function useKeptError(result: Result, query: unknown): Error | null {
  const asked = JSON.stringify(query) ?? "";
  const [kept, setKept] = useState<{ asked: string; error: Error } | null>(null);
  if (result.error !== null && (kept?.error !== result.error || kept.asked !== asked)) {
    setKept({ asked, error: result.error });
  }
  if (result.error !== null) return result.error;
  const empty = result.data === undefined || result.isPlaceholderData;
  return result.isFetching && empty && kept?.asked === asked ? kept.error : null;
}

/** Whether an error says the Checkout is gone: removed, or its Clone unregistered. */
export function isGone(error: Error | null): error is ApiError {
  return error instanceof ApiError && error.status === 410;
}

/** The Events that tell about the part of a Checkout that is gone, else about the Checkout. */
function eventsOf({ clone, worktree, gone }: Schemas["ErrorCheckoutJson"]): Address {
  return gone === "clone" || worktree === null
    ? { kind: "events", params: { clone } }
    : { kind: "events", params: { worktree } };
}

function EventsLink({ error }: { error: Error }) {
  const checkout = error instanceof ApiError ? error.checkout : null;
  if (checkout === null) return null;
  const address = eventsOf(checkout);
  const whose = address.params.clone === undefined ? "worktree" : "clone";
  return <ViewLink address={address} label={`The ${whose}'s events`} named />;
}

/** That loading failed, above what showed before; `children` offer a way on. */
export function LoadNote({ error, children }: { error: Error; children?: ReactNode }) {
  // The Server's refusal says why, e.g. that a branch doesn't exist; else the request failed.
  const refused = error instanceof ApiError && error.status < 500;
  return (
    <p className={styles.problem}>
      {refused ? "Can't show this" : "Couldn't load"}: {error.message} <EventsLink error={error} />
      {children ? " " : null}
      {children}
    </p>
  );
}

/** What a View of a Checkout says in place of its contents once the Checkout is gone. */
export function Gone({ error }: { error: Error }) {
  const text = error.message.charAt(0).toUpperCase() + error.message.slice(1);
  return (
    <p className={styles.problem}>
      {text}. <EventsLink error={error} />
    </p>
  );
}

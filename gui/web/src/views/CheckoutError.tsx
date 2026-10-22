// Why a View of a Checkout can't show it: a note above what it showed before, or, once the
// Checkout is gone, in place of all of it. Both link to the Events that say what happened.

import type { ReactNode } from "react";
import { ApiError, type Schemas } from "../api/client";
import type { Address } from "./address";
import styles from "./CheckoutError.module.css";
import { ViewLink } from "./ViewLink";

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
  const whose = address.params.clone === undefined ? "Worktree" : "Clone";
  return <ViewLink address={address} label={`The ${whose}'s Events`} named />;
}

/** That loading failed, above what showed before; `children` offer a way on. */
export function LoadNote({ error, children }: { error: Error; children?: ReactNode }) {
  return (
    <p className={styles.note}>
      Couldn't load: {error.message} <EventsLink error={error} />
      {children ? " " : null}
      {children}
    </p>
  );
}

/** What a View of a Checkout says in place of its contents once the Checkout is gone. */
export function Gone({ error }: { error: Error }) {
  const text = error.message.charAt(0).toUpperCase() + error.message.slice(1);
  return (
    <p className={styles.note}>
      {text}. <EventsLink error={error} />
    </p>
  );
}

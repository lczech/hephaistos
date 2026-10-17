// The Checkout whose changes a View shows, by its parameters `clone` or `worktree`.

import type { Schemas } from "../../api/client";
import { type Params, paramValues } from "../address";

type Repository = Schemas["RepositoryJson"];

/** A Checkout, by its ID: as the API's parameters and a View's name it. */
export type Checkout = { clone: string } | { worktree: string };

/** The Checkout the parameters name: a Clone or a Worktree, by ID. */
export function checkoutOf(params: Params): Checkout | undefined {
  const [clone] = paramValues(params.clone);
  const [worktree] = paramValues(params.worktree);
  if (clone !== undefined) return { clone };
  if (worktree !== undefined) return { worktree };
  return undefined;
}

/** A Checkout's State as the Repositories list has it: a Clone's or a Worktree's. */
export function checkoutState(
  repositories: Repository[] | undefined,
  checkout: Checkout,
): Schemas["CloneJson"] | Schemas["WorktreeJson"] | undefined {
  for (const clone of repositories?.flatMap((repository) => repository.clones) ?? []) {
    if ("clone" in checkout && clone.id === checkout.clone) return clone;
    const worktree = clone.worktrees.find(
      (found) => "worktree" in checkout && found.id === checkout.worktree,
    );
    if (worktree !== undefined) return worktree;
  }
  return undefined;
}

/** A Checkout's short name, for the tab: its folder's, or its Worktree's. */
export function checkoutName(
  repositories: Repository[] | undefined,
  checkout: Checkout,
): string | undefined {
  for (const clone of repositories?.flatMap((repository) => repository.clones) ?? []) {
    if ("clone" in checkout && clone.id === checkout.clone) return clone.path.split("/").at(-1);
    const worktree = clone.worktrees.find(
      (found) => "worktree" in checkout && found.id === checkout.worktree,
    );
    if (worktree !== undefined) return worktree.name;
  }
  return undefined;
}

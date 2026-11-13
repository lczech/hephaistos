// The Checkout a View shows, by its parameters `clone` or `worktree`.

import type { Schemas } from "../api/client";
import { pathParts } from "../paths";
import { type Params, paramValues } from "./address";

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

/** The Clone a Checkout is, or whose Worktree it is, by ID; undefined while not known. */
export function cloneOf(
  repositories: Repository[] | undefined,
  checkout: Checkout,
): string | undefined {
  if ("clone" in checkout) return checkout.clone;
  const clones = repositories?.flatMap((repository) => repository.clones) ?? [];
  return clones.find((clone) => clone.worktrees.some((found) => found.id === checkout.worktree))
    ?.id;
}

/** The short name of a Checkout, for the tab: that of its folder, as Repositories shows it. Not
 * the name git has for a Worktree, which tools may make an ID of. */
export function checkoutName(
  repositories: Repository[] | undefined,
  checkout: Checkout,
): string | undefined {
  for (const clone of repositories?.flatMap((repository) => repository.clones) ?? []) {
    if ("clone" in checkout && clone.id === checkout.clone) return pathParts(clone.path)[1];
    const worktree = clone.worktrees.find(
      (found) => "worktree" in checkout && found.id === checkout.worktree,
    );
    if (worktree !== undefined) return pathParts(worktree.path)[1];
  }
  return undefined;
}

// A View as a Panel holds it, for tests of Views.

import { type ComponentType, Profiler, useState } from "react";
import { type Address, addressText, type Params } from "../views/address";
import type { ViewProps } from "../views/index";

interface Props {
  view: ComponentType<ViewProps>;
  kind: string;
  params?: Params;
  fragment?: Params;
  onTitle?: (title: string) => void; // told each title the View gives its tab
}

let commits = 0; // React's, of Views in Panels here

function drew(): void {
  commits++;
}

/**
 * That the Views shown stop drawing anew once what they show came: none draws again within
 * `quiet` ms, at most `within` ms from now. A View whose values are new on each draw, and fed
 * back into what it draws, draws on and on, e.g. a find matching anew each time.
 */
export async function expectSettled(quiet = 300, within = 3000): Promise<void> {
  const start = performance.now();
  let seen = commits;
  let since = start;
  while (performance.now() - since < quiet) {
    await new Promise((done) => setTimeout(done, 25));
    if (commits !== seen) [seen, since] = [commits, performance.now()];
    if (performance.now() - start > within) {
      throw new Error(`still drawing anew after ${within} ms, ${commits} times in all`);
    }
  }
}

/**
 * A View with its address, changed as the View changes it and shown as text (a status, before
 * the View's own), and its tab's title, as a heading once it has one.
 */
export function InPanel({ view: View, kind, params = {}, fragment, onTitle }: Props) {
  const [address, setAddress] = useState<Address>({ kind, params, ...(fragment && { fragment }) });
  const [title, setTitle] = useState("");
  return (
    <>
      <output>{addressText(address)}</output>
      {title && <h1>{title}</h1>}
      <Profiler id={kind} onRender={drew}>
        <View
          params={address.params}
          setParams={(next) => setAddress((was) => ({ ...was, params: next }))}
          fragment={address.fragment ?? {}}
          setFragment={(next) => setAddress((was) => ({ ...was, fragment: next }))}
          endTyping={() => {}}
          setTitle={(next) => {
            setTitle(next);
            onTitle?.(next);
          }}
        />
      </Profiler>
    </>
  );
}

// A View as a Panel holds it, for tests of Views.

import { type ComponentType, useState } from "react";
import { type Address, addressText, type Params } from "../views/address";
import type { ViewProps } from "../views/index";

interface Props {
  view: ComponentType<ViewProps>;
  kind: string;
  params?: Params;
  fragment?: Params;
  onTitle?: (title: string) => void; // told each title the View gives its tab
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
    </>
  );
}

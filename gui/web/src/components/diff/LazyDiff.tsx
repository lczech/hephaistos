import { type ComponentProps, lazy, Suspense } from "react";

const Diff = lazy(() => import("./Diff"));

/** A file's diff, as `Diff` shows it, once its renderer has loaded. */
export function LazyDiff(props: ComponentProps<typeof Diff>) {
  return (
    <Suspense fallback={<p>Loading the diff…</p>}>
      <Diff {...props} />
    </Suspense>
  );
}

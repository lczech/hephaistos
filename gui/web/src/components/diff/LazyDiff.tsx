import { type ComponentProps, lazy, type ReactNode, Suspense } from "react";

const Diff = lazy(() => import("./Diff"));
const DiffScroll = lazy(() => import("./Diff").then((module) => ({ default: module.DiffScroll })));

const LOADING = <p>Loading the diff…</p>;

/** A file's diff, as `Diff` shows it, once its renderer has loaded; `fallback` until then. */
export function LazyDiff({
  fallback = LOADING,
  ...props
}: ComponentProps<typeof Diff> & { fallback?: ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <Diff {...props} />
    </Suspense>
  );
}

/** Where diffs scroll, as `DiffScroll` is, once the renderer has loaded. */
export function LazyDiffScroll(props: ComponentProps<typeof DiffScroll>) {
  return (
    <Suspense fallback={LOADING}>
      <DiffScroll {...props} />
    </Suspense>
  );
}

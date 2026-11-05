import { ago, fullTime } from "../time";

/** A time as `5m ago`, in full when hovered; nothing if unknown. */
export function Ago({ at, now }: { at: string | null; now: number | undefined }) {
  if (at === null) return "";
  return <span title={fullTime(at)}>{ago(at, now ?? Date.now())}</span>;
}

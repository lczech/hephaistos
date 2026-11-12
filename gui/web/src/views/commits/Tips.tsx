import type { ReactNode } from "react";
import { cssVars } from "../../components/cssVars";
import { shortHash } from "../../revisions";
import styles from "./CommitList.module.css";
import { CommitRefs } from "./columns";
import { GraphTips } from "./Graph";
import { branchOf, type Drawn, shownRefs, type Tip, tipsAt } from "./rows";

/**
 * A graph's band, below the list's header once the rows scroll under it: the tips of the lines
 * going on below the row at the top, which started in it or above it, by lane; in the graph's
 * column their nodes, from which their lines go down, in the subject's their badges, in one line
 * cut off at its end, a click on which goes to the tip. The lines of the others pass. The tip of
 * the row coming in below slides in with it, as far down as its row (`at`), so that it does not
 * show only once there; those whose lines end in that row are pushed out by it, up by as much as
 * it has risen into the band.
 */
export function tipsBand(
  drawn: Drawn,
  head: string | null | undefined,
  onTip: (id: string) => void,
): (
  row: number,
  coming?: { row: number; at: number; height: number },
) => Partial<Record<string, ReactNode>> {
  return (row, coming) => {
    const { lines, tips } = tipsAt(drawn, row, head, coming?.row);
    const by = (tip: Tip) => {
      if (coming === undefined) return 0;
      if (tip.coming) return coming.at;
      return tip.leaving ? coming.at - coming.height : 0;
    };
    return {
      graph: (
        <GraphTips
          layout={drawn.layout}
          lines={lines}
          tips={tips.map((tip) => ({ ...tip, by: by(tip) }))}
          {...(coming ? { next: { row: coming.row, at: coming.at } } : {})}
        />
      ),
      subject: (
        <span className={styles.tips}>
          {tips.map((tip) => (
            <button
              key={tip.row}
              type="button"
              tabIndex={-1} // a copy, seen: the rows and "Go to…" are for the keys
              className={styles.tip}
              style={cssVars({ "--by": `${by(tip)}px` })}
              title={`Go to ${tipName(tip, drawn)}`}
              onClick={() => onTip(tip.id)}
            >
              <CommitRefs
                commit={tip.commit}
                head={tip.commit.hash === head}
                graph={drawn}
                colour={tip.colour}
              />
            </button>
          ))}
        </span>
      ),
    };
  };
}

/** What a tip is called: its branch, else its first ref, else the Checkout detached there. */
function tipName(tip: Tip, drawn: Drawn): string {
  const refs = shownRefs(tip.commit.refs, drawn.drawing);
  const detached = drawn.drawing.checkedOut?.find(
    (each) => each.branch === null && each.commit === tip.commit.hash,
  );
  return branchOf(refs) ?? refs[0]?.name ?? detached?.name ?? shortHash(tip.commit.hash);
}

import { GitMerge } from "lucide-react";
import { Ago } from "../../components/Ago";
import { Chevron } from "../../components/list/List";
import { listColumnHelper } from "../../components/list/table";
import { TextIcon } from "../../components/TextIcon";
import { counted, numberText } from "../../text";
import { daysText } from "../../time";
import type { Checkout } from "../checkout";
import { CommitHash, RefLabels } from "./CommitBox";
import styles from "./CommitList.module.css";
import { colourOf, fittedWidth, GraphCell } from "./Graph";
import type { LaneColour } from "./lanes";
import {
  branchOf,
  branchThrough,
  type Drawn,
  type Entry,
  entryId,
  type Found,
  type Line,
  type Stretch,
  shownRefs,
  whereText,
} from "./rows";

const column = listColumnHelper<Entry>();

const SHOWN_REFS = 3; // branches and tags a commit not listed offers to show it on; more counted

/** What a commit searched for by its hash, not listed, offers: its branch, or all files. */
export interface FoundActions {
  walked: string; // what the list walks back from: `main`, `HEAD`
  path: string | undefined;
  showOn: (ref: string) => void;
  allFiles: () => void;
}

/**
 * The columns of a list of commits: the hash of a commit, with its Changes and Diff; its subject
 * after its branches and tags; who wrote it, and when. The row of a rename says only where the
 * file was before; that of a stretch, how many commits it leaves out and their days, as its
 * subject.
 */
export function commitColumns(
  checkout: Checkout | undefined,
  head: string | null | undefined,
  actions: FoundActions | undefined,
  graph: Drawn | undefined,
) {
  return column.columns([
    column.display({
      id: "square",
      cell: ({ row }) => (row.original.type === "commit" ? <Chevron /> : ""),
      enableResizing: false,
      meta: { width: "var(--square)" },
    }),
    ...(graph === undefined
      ? []
      : [
          column.display({
            id: "graph",
            header: "graph",
            size: fittedWidth(graph.layout.columns),
            minSize: fittedWidth(1), // one lane, narrower than other columns may be
            meta: {
              stays: true, // the lanes below an opened row line up with it
              description: "How the commits descend from each other, a line per lane",
            },
            cell: ({ row }) => {
              const at = graph.rows.get(entryId(row.original));
              return at === undefined ? "" : <GraphCell layout={graph.layout} row={at} />;
            },
          }),
        ]),
    column.display({
      id: "commit",
      header: "commit",
      size: 150,
      cell: ({ row }) => {
        if (checkout === undefined) return "";
        if (row.original.type === "uncommitted") {
          return <CommitHash hash={undefined} checkout={row.original.of?.checkout ?? checkout} />;
        }
        if (row.original.type === "found") {
          return <CommitHash hash={row.original.found.commit.hash} checkout={checkout} />;
        }
        return row.original.type === "commit" ? (
          <CommitHash hash={row.original.commit.hash} checkout={checkout} />
        ) : (
          ""
        );
      },
    }),
    column.display({
      id: "subject",
      header: "subject",
      size: 480,
      meta: { identifies: true },
      cell: ({ row, table }) => {
        const entry = row.original;
        if (entry.type === "uncommitted")
          return (
            <span className={styles.uncommitted} data-entry={entryId(entry)}>
              {entry.text}
            </span>
          );
        if (entry.type === "found") {
          return actions ? (
            <FoundWhere found={entry.found} actions={actions} />
          ) : (
            entry.found.commit.subject
          );
        }
        if (entry.type === "stretch") {
          const at = graph?.rows.get(entryId(entry));
          const branch = graph && at !== undefined ? branchThrough(graph, at) : undefined;
          return (
            <span className={styles.stretch} title={stretchTitle(entry, branch)}>
              {counted(entry.count, "commit")},{" "}
              {daysText(entry.oldest, entry.newest, table.options.meta?.now ?? Date.now())}
            </span>
          );
        }
        if (entry.type === "renamed") {
          return (
            <span className={styles.renamed} title={`renamed from ${entry.from}`}>
              renamed from <span className={styles.path}>{entry.from}</span>
            </span>
          );
        }
        const { commit } = entry;
        const at = graph?.rows.get(entryId(entry));
        const lane = at === undefined ? undefined : graph?.layout.rows[at];
        return (
          <span title={commit.subject} data-entry={entryId(entry)}>
            <CommitRefs
              commit={commit}
              head={commit.hash === head}
              graph={graph}
              colour={lane?.colour}
            />
            {commit.parents.length > 1 && (
              <span title="Merge commit: changes shown against its first parent">
                <TextIcon icon={GitMerge} className={styles.icon} label="merge" />
              </span>
            )}
            {commit.subject}
          </span>
        );
      },
    }),
    column.display({
      id: "author",
      header: "author",
      size: 140,
      meta: { second: true },
      cell: ({ row }) =>
        row.original.type === "commit" ? (
          <span title={row.original.commit.author.email}>{row.original.commit.author.name}</span>
        ) : (
          ""
        ),
    }),
    column.display({
      id: "authored",
      header: "authored",
      size: 88,
      meta: {
        second: true,
        figures: true,
        align: "right",
        description: "When the commit was authored; its details also show when it was committed",
      },
      cell: ({ row, table }) => {
        if (row.original.type !== "commit") return "";
        const at = row.original.commit.author.at;
        return <Ago at={at} now={table.options.meta?.now} />;
      },
    }),
  ]);
}

/** What a stretch leaves out, at length: `12 commits of feature between abc1234 and def5678`. */
function stretchTitle(stretch: Stretch, branch: string | undefined): string {
  const of = branch === undefined ? "" : ` of ${branch}`;
  const between = `${stretch.commit.slice(0, 7)} and ${stretch.parent.slice(0, 7)}`;
  return `${counted(stretch.count, "commit")}${of} between ${between}`;
}

/** The branches and tags of a commit, as its row labels them: its branch framed in the colour of
 * its line, if drawn, and where the Checkouts are. */
export function CommitRefs({
  commit,
  head,
  graph,
  colour,
}: {
  commit: Line;
  head: boolean;
  graph: Drawn | undefined;
  colour: LaneColour | undefined;
}) {
  const refs = shownRefs(commit.refs, graph?.drawing);
  const named = branchOf(refs);
  const lead =
    colour && named !== undefined ? { name: named, colour: colourOf(colour) } : undefined;
  const checkedOut = graph?.drawing.checkedOut?.filter((each) => each.commit === commit.hash);
  return (
    <RefLabels
      refs={refs}
      head={head}
      lead={lead}
      {...(checkedOut ? { checkedOut } : {})}
      {...(graph?.drawing.first ? { first: graph.drawing.first } : {})}
    />
  );
}

/** A commit searched for by its hash that is not listed: where it is, and ways to show it. */
function FoundWhere({ found, actions }: { found: Found; actions: FoundActions }) {
  const shown = found.refs.slice(0, SHOWN_REFS);
  const more = found.refs.slice(SHOWN_REFS);
  return (
    <span className={styles.found}>
      <span title={found.commit.subject}>{found.commit.subject}</span>
      <span className={styles.where}>{whereText(found, actions.walked, actions.path)}</span>
      {found.where === "path" && (
        <button type="button" className={styles.action} onClick={actions.allFiles}>
          All files
        </button>
      )}
      {shown.map((ref) => (
        <button
          key={`${ref.kind}:${ref.name}`}
          type="button"
          className={styles.action}
          title={`Show the commits of ${ref.name}`}
          onClick={() => actions.showOn(ref.full)}
        >
          {ref.name}
        </button>
      ))}
      {more.length > 0 && (
        <span className={styles.where} title={more.map((ref) => ref.name).join(", ")}>
          +{numberText(more.length)} more
        </span>
      )}
    </span>
  );
}

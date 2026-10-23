import { GitMerge } from "lucide-react";
import { TextIcon } from "../../components/TextIcon";
import { Chevron } from "../../components/table/ListTable";
import { listColumnHelper } from "../../components/table/list";
import { ago, fullTime } from "../../time";
import type { Checkout } from "../changes/checkout";
import { CommitHash, RefLabels } from "./CommitBox";
import styles from "./HistoryView.module.css";
import { type Entry, type Found, whereText } from "./rows";

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
 * The History list's columns: a commit's hash, with its Changes and Diff; its subject after its
 * branches and tags; who wrote it, and when. A rename's
 * row says only where the file was before.
 */
export function historyColumns(
  checkout: Checkout | undefined,
  head: string | null | undefined,
  actions: FoundActions,
) {
  return column.columns([
    column.display({
      id: "square",
      cell: ({ row }) => (row.original.type === "commit" ? <Chevron /> : ""),
      enableResizing: false,
      meta: { width: "var(--square)" },
    }),
    column.display({
      id: "commit",
      header: "commit",
      size: 150,
      cell: ({ row }) => {
        if (checkout === undefined) return "";
        if (row.original.type === "uncommitted") {
          return <CommitHash hash={undefined} checkout={checkout} />;
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
      cell: ({ row }) => {
        const entry = row.original;
        if (entry.type === "uncommitted")
          return <span className={styles.uncommitted}>{entry.text}</span>;
        if (entry.type === "found") return <FoundWhere found={entry.found} actions={actions} />;
        if (entry.type === "renamed") {
          return (
            <span className={styles.renamed} title={`renamed from ${entry.from}`}>
              renamed from <span className={styles.path}>{entry.from}</span>
            </span>
          );
        }
        const { commit } = entry;
        return (
          <span title={commit.subject}>
            <RefLabels refs={commit.refs} head={commit.hash === head} />
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
        description: "When the commit was authored; its details also show when it was committed",
      },
      cell: ({ row, table }) => {
        if (row.original.type !== "commit") return "";
        const at = row.original.commit.author.at;
        return <span title={fullTime(at)}>{ago(at, table.options.meta?.now ?? Date.now())}</span>;
      },
    }),
  ]);
}

/** A commit searched for by its hash that isn't listed: where it is, and ways to show it. */
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
          +{more.length} more
        </span>
      )}
    </span>
  );
}

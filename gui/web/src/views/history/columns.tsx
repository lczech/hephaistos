import { GitMerge } from "lucide-react";
import { Chevron } from "../../components/table/ListTable";
import { listColumnHelper } from "../../components/table/list";
import { ago, fullTime } from "../../time";
import type { Checkout } from "../changes/checkout";
import { ViewLink } from "../ViewLink";
import { CommitLink, RefLabels } from "./CommitBox";
import styles from "./HistoryView.module.css";
import type { Entry } from "./rows";

const column = listColumnHelper<Entry>();

/**
 * The History list's columns: a commit's hash, a link to its changes; its subject after its
 * branches and tags, which takes the width the others leave; who wrote it, and when. A rename's
 * row says only where the file was before.
 */
export function historyColumns(checkout: Checkout | undefined, head: string | null | undefined) {
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
      size: 96,
      cell: ({ row }) => {
        if (checkout === undefined) return "";
        if (row.original.type === "uncommitted") {
          return (
            <ViewLink
              address={{ kind: "changes", params: checkout }}
              label="Uncommitted changes"
              opening={{ beside: true, preview: true }}
            />
          );
        }
        return row.original.type === "commit" ? (
          <CommitLink hash={row.original.commit.hash} checkout={checkout} />
        ) : (
          ""
        );
      },
    }),
    column.display({
      id: "subject",
      header: "subject",
      enableResizing: false,
      meta: { width: "minmax(8rem, 1fr)" },
      cell: ({ row }) => {
        const entry = row.original;
        if (entry.type === "uncommitted")
          return <span className={styles.uncommitted}>{entry.text}</span>;
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
                <GitMerge className={styles.icon} aria-label="merge" />
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

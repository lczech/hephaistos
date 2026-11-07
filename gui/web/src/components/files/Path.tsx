// Paths as rows and headers show them: after an icon, the folder quieter than the name.

import { Folder } from "lucide-react";
import type { ReactNode } from "react";
import { pathParts } from "../../paths";
import { Marked } from "../find/Marked";
import { TextIcon } from "../TextIcon";
import styles from "./Path.module.css";

/**
 * A path after its icon, its folder quieter, unless `whole`, as a chain of folders joined is one
 * name; struck through if deleted; matches found in it marked, in all of it (`marked`). Cut off
 * where narrow: a file's at its end, a folder's at its start, so that its last part, the one it
 * is, stays.
 */
export function Path({
  shown,
  title,
  icon,
  deleted,
  whole,
  marked,
}: {
  shown: string;
  title: string;
  icon: ReactNode;
  deleted?: boolean;
  whole?: boolean;
  marked?: { marks: readonly [number, number][]; current: boolean };
}) {
  const [folder, name] = pathParts(shown);
  return (
    <span className={styles.named}>
      {icon}
      <span
        className={styles.path}
        title={title}
        data-from-start={name.endsWith("/") || undefined}
        data-deleted={deleted || undefined}
      >
        <bdi>
          {marked ? (
            <Marked text={shown} {...marked} />
          ) : (
            <>
              {whole ? folder : <span className={styles.folder}>{folder}</span>}
              {name}
            </>
          )}
        </bdi>
      </span>
    </span>
  );
}

/** A directory's path, or the end of it that is `shown`, after a folder's icon. */
export function DirectoryPath({ shown, path }: { shown: string; path: string }) {
  return (
    <Path
      shown={shown}
      title={path}
      icon={
        <span className={styles.icon}>
          <TextIcon icon={Folder} />
        </span>
      }
    />
  );
}

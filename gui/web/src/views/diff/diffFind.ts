import { useState } from "react";
import type { DiffFind, DiffMark } from "../../components/diff/Diff";
import { type DiffLine, diffLines } from "../../components/diff/lines";
import type { FindQuery } from "../../components/find/pattern";
import { type Finding, useCurrentMatch, useFind } from "../../components/find/useFind";

/** A file to find in: git's patch for it, and its new version once known. */
export interface FileText {
  path: string;
  patch: string;
  newText: string | null | undefined;
}

/** A match, in which file. */
interface FileMark {
  path: string;
  mark: DiffMark;
}

interface Lines {
  files: readonly FileText[];
  lines: { path: string; line: DiffLine }[];
  texts: string[];
}

interface Marks {
  matches: unknown;
  all: FileMark[];
  byFile: Map<string, DiffMark[]>;
}

/** What a file's diff marks, and whether its current match was stepped to, to show it: e.g. a
 * large diff waiting to be. */
export interface FileFind extends DiffFind {
  revealed: boolean;
}

/** What a diff's find found, and which match is current. */
export interface DiffFinding {
  finding: Finding | undefined; // for the bar: busy while the files aren't there yet
  count: number; // matches on the diffs' lines
  current: number;
  step: (by: 1 | -1) => void;
  /** What one file's diff marks, and where it tells which of its matches are on its lines. */
  findIn: (path: string) => FileFind | undefined;
}

const NONE: readonly DiffMark[] = [];

const sameFiles = (one: readonly FileText[], other: readonly FileText[]) =>
  one.length === other.length &&
  one.every(
    (file, at) =>
      file.path === other[at]?.path &&
      file.patch === other[at]?.patch &&
      file.newText === other[at]?.newText,
  );

/**
 * A query's matches in files' lines, in their order: all lines once a file's new version is
 * known, its patch's until then. They count where they are on the diffs' lines
 * (docs/gui/views.md): the patch's, or all with Whole file (`whole`), until a file's diff,
 * drawn, tells (e.g. once collapsed lines are expanded). Stepping to a match `reveal`s its
 * file, e.g. unfolds it, and says so (`revealed`).
 * Lines and marks are held while what they come from stays, as React keeps what a render
 * showed, rather than memoized: a search starts again only once the lines or the query change,
 * and a current match stays one while the marks do.
 */
export function useDiffFind(
  files: readonly FileText[] | undefined,
  query: FindQuery | undefined,
  whole: boolean,
  reveal?: (path: string) => void,
): DiffFinding {
  const [held, setHeld] = useState<Lines>();
  let lines = held;
  if (files === undefined) lines = undefined;
  else if (held === undefined || !sameFiles(held.files, files)) {
    const all = files.flatMap((file) =>
      diffLines(file.patch, file.newText).map((line) => ({ path: file.path, line })),
    );
    lines = { files, lines: all, texts: all.map(({ line }) => line.text) };
    setHeld(lines);
  }
  const found = useFind(query && lines?.texts, query);
  const matches = found && "matches" in found ? found.matches : undefined;
  const [marked, setMarked] = useState<Marks>({ matches: undefined, all: [], byFile: new Map() });
  let marks = marked;
  if (marked.matches !== matches) {
    const all = (matches ?? []).flatMap(({ line, start, end }) => {
      const at = lines?.lines[line];
      if (at === undefined) return [];
      const { old, new: current, collapsed } = at.line;
      return [{ path: at.path, mark: { old, new: current, start, end, collapsed } }];
    });
    const byFile = new Map<string, DiffMark[]>();
    for (const { path, mark } of all) byFile.set(path, [...(byFile.get(path) ?? []), mark]);
    marks = { matches, all, byFile };
    setMarked(marks);
  }
  // Which of each file's matches are on its lines, as its diff told, while its matches stay.
  const [told, setTold] = useState<ReadonlyMap<string, { marks: unknown; shown: number[] }>>(
    new Map(),
  );
  const shown: number[] = [];
  let offset = 0;
  for (const [path, inFile] of marks.byFile) {
    const said = told.get(path);
    const local =
      said?.marks === inFile
        ? said.shown
        : inFile.flatMap((mark, at) => (whole || !mark.collapsed ? [at] : []));
    shown.push(...local.map((at) => offset + at));
    offset += inFile.length;
  }
  const [current, stepTo] = useCurrentMatch(marks.all, shown.length);
  const at = (index: number) => marks.all[shown[index] ?? -1];
  // The match last stepped to, revealed then: typing leaves folds and large diffs as they are.
  const [stepped, setStepped] = useState<FileMark>();
  const step = (by: 1 | -1) => {
    const next = shown.length > 0 ? at((current + by + shown.length) % shown.length) : undefined;
    if (next) reveal?.(next.path);
    setStepped(next);
    stepTo(by);
  };
  const currentMark = at(current);
  const finding =
    query && files === undefined && query.text !== "" ? { busy: true as const } : found;
  return {
    finding,
    count: shown.length,
    current,
    step,
    findIn: (path) =>
      query && {
        marks: marks.byFile.get(path) ?? NONE,
        current: currentMark?.path === path ? currentMark.mark : undefined,
        revealed: currentMark?.path === path && currentMark === stepped,
        onShown: (inFile) =>
          setTold((told) => {
            const next = new Map(told);
            if (inFile === undefined) next.delete(path);
            else next.set(path, { marks: marks.byFile.get(path), shown: [...inFile] });
            return next;
          }),
      },
  };
}

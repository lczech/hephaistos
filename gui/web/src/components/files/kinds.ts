// What kind of file a name says, for its icon: exact names first, ours then those of GitHub
// Linguist, but for locks and configs, which our extensions say better; then extensions, our own
// table first, for what Linguist does not know (binary files) or decides otherwise than we would
// show it, then the languages of Linguist (`linguist.json`, written by `scripts/linguist.mjs`),
// by their type or, for some, by the language itself.

import {
  File,
  FileArchive,
  FileBraces,
  FileCode,
  FileCog,
  FileDigit,
  FileHeadphone,
  FileImage,
  FileKey,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideoCamera,
  type LucideIcon,
} from "lucide-react";
import linguist from "./linguist.json";

export type FileKind =
  | "text"
  | "code"
  | "data"
  | "spreadsheet"
  | "shell"
  | "config"
  | "lock"
  | "key"
  | "image"
  | "audio"
  | "video"
  | "archive"
  | "font"
  | "binary"
  | "file";

export const KIND_ICONS: Record<FileKind, LucideIcon> = {
  text: FileText,
  code: FileCode,
  data: FileBraces,
  spreadsheet: FileSpreadsheet,
  shell: FileTerminal,
  config: FileCog,
  lock: FileLock,
  key: FileKey,
  image: FileImage,
  audio: FileHeadphone,
  video: FileVideoCamera,
  archive: FileArchive,
  font: FileType,
  binary: FileDigit,
  file: File,
};

/** Text files known by their whole name, without an extension. */
const NAMES: Record<string, FileKind> = Object.fromEntries(
  ["README", "CHANGELOG", "TODO", "AUTHORS", "CONTRIBUTING", "COPYING", "NOTICE"].map((name) => [
    name,
    "text",
  ]),
);

function kindOf(kind: FileKind, extensions: string[]): [string, FileKind][] {
  return extensions.map((extension) => [`.${extension}`, kind]);
}

/** Extensions by kind: those Linguist does not know, and those we show otherwise than it would. */
const EXTENSIONS: Record<string, FileKind> = Object.fromEntries([
  ...kindOf("text", [
    "md",
    "markdown",
    "txt",
    "text",
    "rst",
    "adoc",
    "pdf",
    "doc",
    "docx",
    "odt",
    "rtf",
  ]),
  ...kindOf("text", ["tex", "bib", "ltx", "sty", "cls"]),
  ...kindOf("code", ["sql", "pm", "inc"]),
  ...kindOf("spreadsheet", ["csv", "tsv", "xls", "xlsx", "ods"]),
  ...kindOf("config", ["ini", "cfg", "conf", "env", "properties"]),
  ...kindOf("lock", ["lock"]),
  ...kindOf("key", ["pem", "key", "crt", "cer", "der", "p12", "pfx", "pub", "gpg", "asc", "sig"]),
  ...kindOf("image", ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "ico", "icns"]),
  ...kindOf("image", ["heic", "heif", "avif", "svg", "psd", "xcf", "eps"]),
  ...kindOf("audio", ["mp3", "wav", "flac", "ogg", "oga", "opus", "m4a", "aac", "aiff", "mid"]),
  ...kindOf("video", ["mp4", "m4v", "mkv", "webm", "mov", "avi", "wmv", "mpg", "mpeg"]),
  ...kindOf("archive", ["zip", "tar", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar", "jar", "whl"]),
  ...kindOf("archive", ["deb", "rpm", "dmg", "iso", "apk"]),
  ...kindOf("font", ["ttf", "otf", "woff", "woff2", "eot"]),
  ...kindOf("binary", ["exe", "dll", "so", "dylib", "o", "a", "lib", "bin", "class", "pyc"]),
  ...kindOf("binary", ["wasm", "sqlite", "sqlite3", "db", "pickle", "npy", "npz", "parquet"]),
]);

/** Languages shown by a kind of their own, rather than by their type's. */
export const LANGUAGES: Record<string, FileKind> = {
  Shell: "shell",
  PowerShell: "shell",
  Batchfile: "shell",
  fish: "shell",
  Tcsh: "shell",
  INI: "config",
  "Git Config": "config",
  EditorConfig: "config",
  "Ignore List": "config",
  Dotenv: "config",
  Markdown: "text",
  Text: "text",
  reStructuredText: "text",
  AsciiDoc: "text",
  TeX: "text",
  BibTeX: "text",
};

/** Linguist's types, as kinds. */
const TYPES: Record<string, FileKind> = {
  programming: "code",
  markup: "code",
  data: "data",
  prose: "text",
};

const types: Record<string, string> = linguist.types;
const languageExtensions: Record<string, string> = linguist.extensions;
const languageNames: Record<string, string> = linguist.filenames;

/** Extensions Linguist leaves to us: those whose languages differ in type. */
export const UNSETTLED: readonly string[] = linguist.unsettled;

function ofLanguage(language: string | undefined): FileKind | undefined {
  if (language === undefined) return undefined;
  const type = types[language];
  return LANGUAGES[language] ?? (type === undefined ? undefined : TYPES[type]);
}

/** A name's extensions, the longest first: `a.tar.gz` → `.tar.gz`, `.gz`. */
function extensions(name: string): string[] {
  const lower = name.toLowerCase();
  const found: string[] = [];
  for (let at = lower.indexOf(".", 1); at !== -1; at = lower.indexOf(".", at + 1)) {
    found.push(lower.slice(at));
  }
  return found;
}

/**
 * What kind of file `name` is: by exact names, ours then Linguist's, as more telling than most
 * extensions (`CMakeLists.txt`, `requirements.txt`); but our extensions saying a lock or a
 * config first, as Linguist names many of those by their format (`uv.lock` TOML); then by
 * extensions, ours then Linguist's, the longest first; else a plain file.
 */
export function fileKind(name: string): FileKind {
  const named = NAMES[name];
  if (named !== undefined) return named;
  const found = extensions(name);
  const ours = found.map((extension) => EXTENSIONS[extension]).find((kind) => kind !== undefined);
  if (ours === "lock" || ours === "config") return ours;
  const byName = ofLanguage(languageNames[name]);
  if (byName !== undefined) return byName;
  if (ours !== undefined) return ours;
  for (const extension of found) {
    const kind = ofLanguage(languageExtensions[extension]);
    if (kind !== undefined) return kind;
  }
  return "file";
}

/** Whether our table settles an extension Linguist leaves to us. */
export function settled(extension: string): boolean {
  return EXTENSIONS[extension] !== undefined;
}

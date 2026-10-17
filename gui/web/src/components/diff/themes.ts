import { bundledThemesInfo } from "shiki/themes";

/** Code themes by name, for light and dark mode. */
export interface CodeThemes {
  light: string;
  dark: string;
}

export const DEFAULT_THEMES: CodeThemes = { light: "github-light", dark: "github-dark" };

const KNOWN = new Set<string>(bundledThemesInfo.map((theme) => theme.id));

/** The themes to use: those named, if known, else the defaults; and the names not known. */
export function codeThemes(named: Partial<CodeThemes>): [CodeThemes, string[]] {
  const unknown: string[] = [];
  const known = (name: string | undefined, fallback: string) => {
    if (name === undefined || KNOWN.has(name)) return name ?? fallback;
    unknown.push(name);
    return fallback;
  };
  const themes = {
    light: known(named.light, DEFAULT_THEMES.light),
    dark: known(named.dark, DEFAULT_THEMES.dark),
  };
  return [themes, unknown];
}

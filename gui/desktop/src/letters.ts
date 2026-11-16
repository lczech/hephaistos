// The letter of a key, for the keys of the window (`rules.ts`) and of the page alike: the GUI
// (gui/web) imports it from here, as the Desktop compiles only its own folder (`rootDir`).

/** A key as typed (`key`), and its place on a US keyboard (`code`, e.g. `KeyR`). */
export interface Pressed {
  key: string;
  code: string;
}

/**
 * The Latin letter a key types, in lower case, whatever Caps Lock makes of it; where the letter
 * typed is not Latin, e.g. on a Cyrillic layout, that of its place on a US keyboard, so that
 * Ctrl+R still reloads and Ctrl+W still closes. Not by its place otherwise, which on AZERTY is
 * that of another letter.
 */
export function letterOf({ key, code }: Pressed): string | undefined {
  const typed = key.toLowerCase();
  if (/^[a-z]$/.test(typed)) return typed;
  if (!/^\p{L}$/u.test(key)) return undefined;
  return /^Key([A-Z])$/.exec(code)?.[1]?.toLowerCase();
}

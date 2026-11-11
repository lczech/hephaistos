// Colours by name: a hue for any name, the same wherever and whenever it is asked for, at the
// lightness and chroma of the theme (`--hue-*` in theme.css), so that all read alike.

/** The hue of a name, 0 to 360: the same for the same name, in any session. */
export function hueOf(name: string): number {
  // FNV-1a over UTF-16 code units: cheap, and neighbouring names land far apart.
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 3600) / 10;
}

/** A colour of the hue, as CSS: at the theme's lightness, its chroma or the muted one. */
export function hueColour(hue: number, muted = false): string {
  const chroma = muted ? "var(--hue-chroma-muted)" : "var(--hue-chroma)";
  return `oklch(var(--hue-lightness) ${chroma} ${hue})`;
}

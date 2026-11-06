// Writes what GitHub's Linguist knows of file names, compactly, for the Explorer's icons
// (`web/src/components/files/kinds.ts`): each language's type, and the language of each
// extension and exact file name. Run by `npm run types`; its output is not committed.
//
// An extension several languages claim goes to those claiming it first, as their main one;
// if they differ in type, it is left out and listed as unsettled, for our own table to settle.

import { readFileSync, writeFileSync } from "node:fs";
import * as linguist from "linguist-languages";

const OUTPUT = new URL("../web/src/components/files/linguist.json", import.meta.url);

/** Of the languages claiming a name, those it is settled to, else none. */
function settle(claims) {
  const main = claims.filter((claim) => claim.main);
  const pool = main.length > 0 ? main : claims;
  const types = new Set(pool.map((claim) => claim.type));
  return types.size === 1 ? pool.map((claim) => claim.name).sort()[0] : undefined;
}

function mapped(byName) {
  const settled = {};
  const unsettled = [];
  for (const [key, claims] of [...byName].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const name = settle(claims);
    if (name === undefined) unsettled.push(key);
    else settled[key] = name;
  }
  return { settled, unsettled };
}

const types = {};
const extensions = new Map();
const filenames = new Map();
for (const language of Object.values(linguist)) {
  types[language.name] = language.type;
  (language.extensions ?? []).forEach((extension, index) => {
    const key = extension.toLowerCase();
    const claims = extensions.get(key) ?? [];
    claims.push({ name: language.name, type: language.type, main: index === 0 });
    extensions.set(key, claims);
  });
  for (const filename of language.filenames ?? []) {
    const claims = filenames.get(filename) ?? [];
    claims.push({ name: language.name, type: language.type, main: true });
    filenames.set(filename, claims);
  }
}

const byExtension = mapped(extensions);
const byFilename = mapped(filenames);
const PACKAGE = new URL("../node_modules/linguist-languages/package.json", import.meta.url);
const { version } = JSON.parse(readFileSync(PACKAGE, "utf8"));
writeFileSync(
  OUTPUT,
  `${JSON.stringify({
    version,
    types,
    extensions: byExtension.settled,
    filenames: byFilename.settled,
    unsettled: [...byExtension.unsettled, ...byFilename.unsettled],
  })}\n`,
);

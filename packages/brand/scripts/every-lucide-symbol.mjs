// every-lucide-symbol.mjs -- every Lucide glyph as an SF Symbols template, outlined when the iOS app's catalog is written rather than committed.
//
// A section's icon may be any Lucide glyph the panel's picker offers, so the
// app's catalog holds each one. Note that the templates are outlined from the
// lucide-react @repo/ui resolves, as the committed few are
// (`generate-surface-shared.mjs`), and only when a prebuild writes the
// catalog, because all of them run to megabytes of SVG.

import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { regularSymbolTemplate } from "./lucide-symbols.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_MANIFEST = join(HERE, "..", "..", "ui", "package.json");

/** A glyph's asset name: Lucide's own component name, "arrow-down-0-1" as "ArrowDown01". */
export const lucideAssetName = (icon) =>
  icon.replace(/(?:^|-)([a-z0-9])/g, (_, letter) => letter.toUpperCase());

/** Where lucide-react keeps one module per glyph, each exporting its drawing. */
function iconsDirectory() {
  return dirname(createRequire(UI_MANIFEST).resolve("lucide-react/dist/esm/icons/x.mjs"));
}

/**
 * Every Lucide glyph by its asset name, with its drawing. Note that an alias
 * (`trash-2`) re-exports another glyph's component with no drawing of its
 * own, so it is left out: its name is the glyph it stands for.
 */
async function drawings() {
  const directory = iconsDirectory();
  const files = readdirSync(directory).filter((file) => file.endsWith(".mjs"));

  const read = await Promise.all(
    files.map(async (file) => {
      const { __iconData } = await import(pathToFileURL(join(directory, file)).href);

      return __iconData === undefined
        ? undefined
        : { name: lucideAssetName(basename(file, ".mjs")), node: __iconData.node };
    }),
  );

  return read.filter((drawing) => drawing !== undefined).sort((a, b) => (a.name < b.name ? -1 : 1));
}

/**
 * Every Lucide glyph by its asset name but those `held` names, each as its
 * Regular weight alone (`regularSymbolTemplate`), while the glyphs the app
 * names keep their committed variable templates (`LUCIDE_SYMBOL_TEMPLATES`),
 * which `held` leaves out.
 */
export async function everyLucideSymbol(held = new Set()) {
  return (await drawings())
    .filter(({ name }) => !held.has(name))
    .map(({ name, node }) => ({ name, svg: regularSymbolTemplate(node) }));
}

/** Every Lucide glyph's asset name, sorted, as the app's runtime list names them. */
export async function everyLucideName() {
  return (await drawings()).map(({ name }) => name);
}

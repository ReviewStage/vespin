// lucide-catalog.mjs -- every Lucide glyph, by the name the iOS app's asset catalog holds it under, outlined into a symbol template when the app's prebuild asks.
//
// The drawings are read from the lucide-react @repo/ui resolves, so the
// phone holds the panel's glyphs at the very version it pins, and a section
// may wear any glyph the panel's icon picker offers. Each is outlined
// (scripts/lucide-symbols.mjs) at prebuild rather than committed, since the
// whole set's templates run to about 15 MB of SVG.

import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { symbolTemplate } from "./lucide-symbols.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_MANIFEST = join(HERE, "..", "..", "ui", "package.json");
const ICON_SUFFIX = ".mjs";

const lucideFrom = createRequire(UI_MANIFEST);

/** The asset's name: Lucide's own component name, "git-merge" as "GitMerge", "arrow-down-0-1" as "ArrowDown01". */
export const lucideAssetName = (icon) =>
  icon.replace(/(?:^|-)([a-z0-9])/g, (_, letter) => letter.toUpperCase());

/** One Lucide icon's drawing by its file name, or nothing for an alias, which re-exports another icon's component alone. */
function lucideIconNode(icon) {
  const { __iconData } = lucideFrom(`lucide-react/dist/esm/icons/${icon}${ICON_SUFFIX}`);

  return __iconData?.node;
}

/** Every Lucide icon's file name, aliases among them, in order. */
function lucideFiles() {
  const folder = join(dirname(lucideFrom.resolve("lucide-react/package.json")), "dist/esm/icons");

  return readdirSync(folder)
    .filter((file) => file.endsWith(ICON_SUFFIX))
    .map((file) => file.slice(0, -ICON_SUFFIX.length))
    .sort();
}

/**
 * Lucide's glyphs as symbol templates under their assets' names, which the
 * app's config writes into an asset catalog: every one that draws, aliases
 * left out, or only those `names` asks for, as an extension carries.
 */
export function lucideCatalog(names) {
  const asked = names === undefined ? undefined : new Set(names);

  return lucideFiles().flatMap((icon) => {
    const name = lucideAssetName(icon);

    if (asked !== undefined && !asked.has(name)) return [];

    const node = lucideIconNode(icon);

    return node === undefined ? [] : [{ name, svg: symbolTemplate(node) }];
  });
}

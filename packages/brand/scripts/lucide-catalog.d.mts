// lucide-catalog.d.mts -- the types of lucide-catalog.mjs, which the iOS app's config calls at prebuild.

/** One Lucide glyph as a symbol template, under the name the asset catalog holds it as. */
export interface LucideSymbolTemplate {
  readonly name: string;
  readonly svg: string;
}

/** The asset's name: Lucide's own component name, "git-merge" as "GitMerge". */
export function lucideAssetName(icon: string): string;

/** Lucide's glyphs as symbol templates: every one that draws, or only those `names` asks for. */
export function lucideCatalog(names?: readonly string[]): readonly LucideSymbolTemplate[];

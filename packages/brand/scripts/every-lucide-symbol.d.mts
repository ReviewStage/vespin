// every-lucide-symbol.d.mts -- the types of every-lucide-symbol.mjs, for the iOS app's config.

/** A glyph's asset name: Lucide's own component name, "arrow-down-0-1" as "ArrowDown01". */
export declare const lucideAssetName: (icon: string) => string;

/** Every Lucide glyph by its asset name but those `held`, each as a static SF Symbols template. */
export declare function everyLucideSymbol(
  held?: ReadonlySet<string>,
): Promise<readonly { name: string; svg: string }[]>;

/** Every Lucide glyph's asset name, sorted. */
export declare function everyLucideName(): Promise<readonly string[]>;

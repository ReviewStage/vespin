/**
 * icons.ts -- the one door every icon is imported through.
 *
 * Lucide's glyphs by Lucide's own names, the registry that says which one
 * glyph stands for each concept the app draws, and the seats an icon is drawn
 * at. A screen asks for a concept (`GLYPH.TASK`) and seats it
 * (`<GlyphSlot size={ICON_SIZE.MEDIUM}>`); it reaches for a Lucide name only
 * for a glyph that is no concept of its own. Nothing outside `@repo/ui` imports
 * `lucide-react`, bar the files that still do until each screen moves here.
 *
 * `@repo/ui`'s own glyphs (`face/glyphs.tsx`) are reached through `GLYPH`, and
 * through the barrel under their old names until the last screen that imports
 * one moves. A door re-exports no name the barrel exports, so the glyphs'
 * names are not repeated here.
 */

export * from "lucide-react";

export { GLYPH } from "./glyph-registry.js";

export { ICON_SIZE } from "./icon-size.js";

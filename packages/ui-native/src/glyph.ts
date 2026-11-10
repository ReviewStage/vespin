// glyph.ts -- a mark's glyph: an SF Symbol, or one of Lucide's the app's asset catalog holds as a custom symbol.

import type { SfSymbol } from "./sf-symbol.js";
import type { StatusTone } from "./tokens/colors.js";
import { LUCIDE_SYMBOL } from "./tokens/lucide-symbols.js";

/** One of Lucide's glyphs, by the name the app's asset catalog holds its symbol set under. */
export type LucideSymbol = (typeof LUCIDE_SYMBOL)[keyof typeof LUCIDE_SYMBOL];

/**
 * A glyph a mark draws: the SF Symbol closest to the panel's Lucide glyph,
 * or, for a mark that is our own and that SF Symbols has no drawing of
 * (a pull request, a branch, a decide ask), Lucide's own, which
 * `apps/mobile/app.config.ts` writes into the asset catalog as a custom
 * symbol, so either sizes, weighs, and sits on its text's baseline alike.
 */
export type Glyph = SfSymbol | LucideSymbol;

const LUCIDE_SYMBOLS: ReadonlySet<Glyph> = new Set(Object.values(LUCIDE_SYMBOL));

/** Whether the glyph is one of Lucide's, drawn from the asset catalog rather than the system's symbols. */
export function isLucideSymbol(glyph: Glyph): glyph is LucideSymbol {
  return LUCIDE_SYMBOLS.has(glyph);
}

/** A mark's glyph and the tone it is drawn in. */
export type MarkLook = { readonly symbol: Glyph; readonly tone: StatusTone };

// workspace-tile-model.ts -- what a workspace's tile is drawn from where SwiftUI takes no view of ours: its letter's symbol for a menu's row, and its hue.

import { identityHue, identityLetter } from "@repo/features/workspace-tile";
import type { SfSymbol } from "./sf-symbol.js";
import { IDENTITY_HUE } from "./tokens/identity-hues.js";

/** A letter or digit SF Symbols draws on a filled square, `a.square.fill` through `z.square.fill` and `0.square.fill` through `9.square.fill`. */
const SQUARED = /^[a-z0-9]$/u;

/** The plain filled square, for a name whose first character SF Symbols draws no square of. */
const NO_LETTER_SYMBOL = "square.fill";

/**
 * A workspace's tile as a menu's row draws it: its letter on SF Symbols'
 * filled square. Note that a menu row takes an image and never a view of
 * ours, so the letter is the system's symbol rather than the tile's own
 * drawing, and a name opening on a character SF Symbols squares none of,
 * an accented letter or an emoji, stands on the plain square.
 */
export function tileSymbol(name: string): SfSymbol {
  const letter = identityLetter(name).toLowerCase();
  // SAFETY: SF Symbols names a filled square for every letter and digit `SQUARED` passes.
  return (SQUARED.test(letter) ? `${letter}.square.fill` : NO_LETTER_SYMBOL) as SfSymbol;
}

/** The hue a workspace's letter stands on, read off its id, in the light theme or the dark. */
export function tileHue(id: string, dark: boolean): string {
  const hues = dark ? IDENTITY_HUE.DARK : IDENTITY_HUE.LIGHT;
  return hues[identityHue(id) - 1] ?? hues[0];
}

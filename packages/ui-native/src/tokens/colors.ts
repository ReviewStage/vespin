// colors.ts -- the brand's colors for the window's color scheme, and the six status tones in them.

import { useColorScheme } from "react-native";
import { useIncreaseContrast } from "../accessibility.js";
import { BRAND_COLOR } from "./brand-colors.js";

/** One theme's colors, by the role each names. */
export type BrandColors = { readonly [Role in keyof typeof BRAND_COLOR.LIGHT]: string };

/**
 * Where something stands, as its color says it: the same six tones
 * `@repo/ui`'s `status-tone.ts` names, so a task done reads in one green on
 * the Mac and the iPhone alike.
 */
export const STATUS_TONE = {
  /** At rest, or ended with nothing to say: backlog, todo, canceled. */
  NEUTRAL: "neutral",
  /** Still going, with nothing to do yet: a task in progress. */
  WORKING: "working",
  /** Needs a person: an ask waiting on you. */
  ATTENTION: "attention",
  /** Finished well: a task done, an agent finished. */
  COMPLETE: "complete",
  /** GitHub's shipped: a merged pull request. */
  MERGED: "merged",
  /** Failed, or can't go on. */
  DANGER: "danger",
} as const;

export type StatusTone = (typeof STATUS_TONE)[keyof typeof STATUS_TONE];

/** The role each tone inks with. */
const TONE_ROLE = {
  [STATUS_TONE.NEUTRAL]: "TEXT_MUTED",
  [STATUS_TONE.WORKING]: "WORKING",
  [STATUS_TONE.ATTENTION]: "ATTENTION",
  [STATUS_TONE.COMPLETE]: "COMPLETE",
  [STATUS_TONE.MERGED]: "MERGED",
  [STATUS_TONE.DANGER]: "DANGER",
} as const satisfies Record<StatusTone, keyof BrandColors>;

/**
 * A theme as Increase Contrast reads it, from the brand's own stronger roles
 * rather than colors of its own: the quiet ink as the body's, the hairline
 * as the strong edge, and danger's ink as danger's words, as the system's
 * secondary labels and separators darken where the reader asks.
 */
function strongerContrast(colors: BrandColors): BrandColors {
  return {
    ...colors,
    TEXT_MUTED: colors.TEXT_BODY,
    SIDEBAR_INK: colors.TEXT_BODY,
    CHIP_EDGE: colors.CHIP_EDGE_STRONG,
    DANGER: colors.DANGER_TEXT,
  };
}

const STRONGER = {
  LIGHT: strongerContrast(BRAND_COLOR.LIGHT),
  DARK: strongerContrast(BRAND_COLOR.DARK),
} as const;

/**
 * The brand's colors in the window's color scheme, and stronger where the
 * reader turned on Increase Contrast. Note that SwiftUI is handed plain
 * values rather than a dynamic color, so a component reads these on each
 * render and a change of scheme or of contrast draws it again.
 */
export function useColors(): BrandColors {
  const dark = useColorScheme() === "dark";
  const stronger = useIncreaseContrast();
  if (stronger) return dark ? STRONGER.DARK : STRONGER.LIGHT;
  return dark ? BRAND_COLOR.DARK : BRAND_COLOR.LIGHT;
}

/** The ink a tone is drawn in. */
export function toneColor(colors: BrandColors, tone: StatusTone): string {
  return colors[TONE_ROLE[tone]];
}

// colors.ts -- the brand's colors for the window's color scheme, and the six status tones in them.

import { createContext, createElement, type ReactNode, useContext } from "react";
import { useColorScheme } from "react-native";
import { useIncreaseContrast } from "../accessibility.js";
import { BRAND_COLOR } from "./brand-colors.js";

/**
 * One theme's colors, by the role each names, and the roles derived from
 * them: the selected row's fill (`SELECTED`), and a grouped form's ground
 * (`GROUPED`) and the raised fill its rows stand in (`RAISED`).
 */
export type BrandColors = {
  readonly [Role in keyof typeof BRAND_COLOR.LIGHT | "SELECTED" | "GROUPED" | "RAISED"]: string;
};

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
 * A theme as Increase Contrast reads it, from the brand's own roles rather
 * than colors of its own: the quiet ink as the body's, the hairline as the
 * quiet ink, which holds WCAG's 3:1 for a boundary on every ground where the
 * brand's strong edge does not, and danger's ink as danger's words, as the
 * system's secondary labels and separators darken where the reader asks.
 */
function strongerContrast(colors: BrandColors): BrandColors {
  return {
    ...colors,
    TEXT_MUTED: colors.TEXT_BODY,
    SIDEBAR_INK: colors.TEXT_BODY,
    CHIP_EDGE: colors.TEXT_MUTED,
    DANGER: colors.DANGER_TEXT,
  };
}

/**
 * A theme with the roles derived from the brand's own. A selected row's fill
 * is the hairline's color, which Increase Contrast leaves as it is, since it
 * stands under words that must keep 4.5:1 rather than the 3:1 of a boundary.
 * A grouped form's rows stand in the panel's raised fill (`OVERLAY`, its
 * menus' and popovers') on `grouped`, so they read as cards, as iOS
 * Settings' do: white on the light theme's soft gray, and a lifted gray on
 * the dark theme's black.
 */
function theme(
  colors: (typeof BRAND_COLOR)[keyof typeof BRAND_COLOR],
  grouped: string,
): BrandColors {
  return { ...colors, SELECTED: colors.CHIP_EDGE, GROUPED: grouped, RAISED: colors.OVERLAY };
}

// Note that the light theme's form ground is the chip's hover gray rather than the sidebar's, because the sidebar's #fafafa sits too near the cards' white to tell them apart.
const THEME = {
  LIGHT: theme(BRAND_COLOR.LIGHT, BRAND_COLOR.LIGHT.CHIP_HOVER),
  DARK: theme(BRAND_COLOR.DARK, BRAND_COLOR.DARK.SIDEBAR),
} as const;

const STRONGER = {
  LIGHT: strongerContrast(THEME.LIGHT),
  DARK: strongerContrast(THEME.DARK),
} as const;

/**
 * The dark theme of a sheet or popover standing over a regular window, lifted
 * as iOS lifts presented content in dark: the panel's dialog fill
 * (`SURFACE`) as its ground, and its rows on the hairline's lighter gray, so
 * it stands above the dimmed window behind it rather than as a black hole in
 * it. Light is unchanged, since its sheet already reads above the window.
 */
const ELEVATED_DARK = {
  ...THEME.DARK,
  GROUPED: BRAND_COLOR.DARK.SURFACE,
  RAISED: BRAND_COLOR.DARK.CHIP_EDGE,
} as const;

const ELEVATED_STRONGER_DARK = strongerContrast(ELEVATED_DARK);

/** Whether what is drawn stands in a sheet or popover lifted over a regular window. */
const ElevatedContext = createContext(false);

/**
 * The brand's colors in the window's color scheme, and stronger where the
 * reader turned on Increase Contrast. Note that SwiftUI is handed plain
 * values rather than a dynamic color, so a component reads these on each
 * render and a change of scheme or of contrast draws it again.
 */
export function useColors(elevated?: boolean): BrandColors {
  const dark = useColorScheme() === "dark";
  const stronger = useIncreaseContrast();
  const lifted = useContext(ElevatedContext) || elevated === true;

  if (dark && lifted) return stronger ? ELEVATED_STRONGER_DARK : ELEVATED_DARK;

  if (stronger) return dark ? STRONGER.DARK : STRONGER.LIGHT;

  return dark ? THEME.DARK : THEME.LIGHT;
}

/**
 * What stands in a sheet or popover, drawn on the lifted ground in dark
 * (`ELEVATED_DARK`) while `lifted`: while it stands as a form sheet or
 * popover over a regular window, an iPad's or the open Duo's. A full sheet
 * on an iPhone stands over nothing it must be told apart from, so it keeps
 * the plain ground. Note that a sheet stays wrapped whichever it is, so a
 * window crossing the size classes changes the value alone and never
 * remounts what the sheet holds, words typed in it among them.
 */
export function ElevatedGround({
  lifted,
  children,
}: {
  readonly lifted: boolean;
  readonly children: ReactNode;
}) {
  return createElement(ElevatedContext.Provider, { value: lifted }, children);
}

/** The ink a tone is drawn in. */
export function toneColor(colors: BrandColors, tone: StatusTone): string {
  return colors[TONE_ROLE[tone]];
}

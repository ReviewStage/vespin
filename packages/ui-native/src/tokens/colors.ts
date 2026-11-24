// colors.ts -- the brand's colors for the window's color scheme, and the six status tones in them.

import { createContext, createElement, type ReactNode, useContext } from "react";
import { useColorScheme } from "react-native";
import { useIncreaseContrast } from "../accessibility.js";
import { BRAND_COLOR } from "./brand-colors.js";
import { STATUS_TONE, type StatusTone } from "./status-tone.js";

export { STATUS_TONE, type StatusTone };

/**
 * One theme's colors, by the role each names, and the roles derived from
 * them: the selected row's fill (`SELECTED`), a grouped form's ground
 * (`GROUPED`) and the raised fill its rows stand in (`RAISED`), and the fill
 * of a card standing on the page's own ground (`CARD`).
 */
export type BrandColors = {
  readonly [Role in
    | keyof typeof BRAND_COLOR.LIGHT
    | "SELECTED"
    | "GROUPED"
    | "RAISED"
    | "CARD"]: string;
};

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
 * the dark theme's black. A card on the page's ground, such as an ask's,
 * takes the fill iOS sets a card in on a plain page (its secondary
 * background): the soft gray on the light theme's white, where the brand's
 * surface is the ground's own white and the card would read only by its
 * hairline, and the lifted surface on the dark theme's black.
 */
function theme(
  colors: (typeof BRAND_COLOR)[keyof typeof BRAND_COLOR],
  grouped: string,
  card: string,
): BrandColors {
  return {
    ...colors,
    SELECTED: colors.CHIP_EDGE,
    GROUPED: grouped,
    RAISED: colors.OVERLAY,
    CARD: card,
  };
}

// Note that the light theme's form ground is the chip's hover gray rather than the sidebar's, because the sidebar's #fafafa sits too near the cards' white to tell them apart.
const THEME = {
  LIGHT: theme(BRAND_COLOR.LIGHT, BRAND_COLOR.LIGHT.CHIP_HOVER, BRAND_COLOR.LIGHT.CHIP_HOVER),
  DARK: theme(BRAND_COLOR.DARK, BRAND_COLOR.DARK.SIDEBAR, BRAND_COLOR.DARK.SURFACE),
} as const;

const STRONGER = {
  LIGHT: strongerContrast(THEME.LIGHT),
  DARK: strongerContrast(THEME.DARK),
} as const;

/**
 * The dark theme of a sheet or popover standing over the window, lifted
 * as iOS lifts presented content in dark: the panel's dialog fill
 * (`SURFACE`) as every ground it draws on (a plain page's, a list's, and a
 * form's alike, so no face of it drops back to black), and its rows on the
 * hairline's lighter gray, so it stands above the dimmed window behind it
 * rather than as a black hole in it. Light is unchanged, since its sheet
 * already reads above the window.
 */
const ELEVATED_DARK = {
  ...THEME.DARK,
  GROUND: BRAND_COLOR.DARK.SURFACE,
  SIDEBAR: BRAND_COLOR.DARK.SURFACE,
  GROUPED: BRAND_COLOR.DARK.SURFACE,
  RAISED: BRAND_COLOR.DARK.CHIP_EDGE,
} as const;

const ELEVATED_STRONGER_DARK = strongerContrast(ELEVATED_DARK);

/** Whether what is drawn stands in a sheet or popover, lifted over the window. */
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
  const onAccent = useContext(OnAccentContext);
  const colors = baseColors(dark, stronger, lifted);

  return onAccent ? onAccentOf(colors) : colors;
}

/** The theme by the window's scheme, the reader's contrast, and whether it stands lifted. */
function baseColors(dark: boolean, stronger: boolean, lifted: boolean): BrandColors {
  if (dark && lifted) return stronger ? ELEVATED_STRONGER_DARK : ELEVATED_DARK;

  if (stronger) return dark ? STRONGER.DARK : STRONGER.LIGHT;

  return dark ? THEME.DARK : THEME.LIGHT;
}

/** How much of the ink on the accent a fill inside it washes with, and an edge, as two hex digits of alpha. */
const ON_ACCENT_WASH = {
  FILL: "33",
  EDGE: "59",
} as const;

/** Each theme as it reads on the accent, kept once per theme, so a bubble's words draw against one stable value. */
const ON_ACCENT_THEMES = new WeakMap<BrandColors, BrandColors>();

/**
 * A theme as words read on the accent's fill, as the reader's own bubble
 * stands in a Manager's chat, as Messages inks its blue bubble white: every
 * ink, a link's among them, the ink on the accent, and every fill and edge
 * a chip, a code block, or a card inside stands on a wash of that ink, so
 * nothing inside draws the page's gray on copper.
 */
function onAccentOf(colors: BrandColors): BrandColors {
  const kept = ON_ACCENT_THEMES.get(colors);

  if (kept !== undefined) return kept;
  const ink = colors.ON_ACCENT;
  const fill = `${ink}${ON_ACCENT_WASH.FILL}`;
  const edge = `${ink}${ON_ACCENT_WASH.EDGE}`;

  const read: BrandColors = {
    ...colors,
    TEXT: ink,
    TEXT_BODY: ink,
    TEXT_MUTED: ink,
    ACCENT_TEXT: ink,
    SIDEBAR_INK: ink,
    FILL_STRONG: fill,
    WELL: fill,
    CHIP: fill,
    CHIP_HOVER: fill,
    SURFACE: fill,
    CARD: fill,
    CHIP_EDGE: edge,
    CHIP_EDGE_STRONG: edge,
  };

  ON_ACCENT_THEMES.set(colors, read);

  return read;
}

/** Whether what is drawn stands on the accent's fill, such as the reader's own bubble. */
const OnAccentContext = createContext(false);

/** What stands on the accent's fill, its words, links, chips and code inked to read on it (`onAccentOf`). */
export function OnAccentInk({ children }: { readonly children: ReactNode }) {
  return createElement(OnAccentContext.Provider, { value: true }, children);
}

/**
 * What stands in a sheet or popover, drawn on the lifted ground in dark
 * (`ELEVATED_DARK`), as iOS lifts every view it presents: an iPhone's card,
 * standing over the page it slid up from, as much as an iPad's form sheet or
 * popover over the dimmed window, as Mail's and Settings' sheets stand.
 */
export function ElevatedGround({ children }: { readonly children: ReactNode }) {
  return createElement(ElevatedContext.Provider, { value: true }, children);
}

/** A navigation bar's appearance: the window's own light or dark. */
export type BarScheme = "light" | "dark";

/**
 * The light or dark a stack's navigation bar is drawn in, the window's own.
 * Note that a native stack hands every bar a fixed appearance from its
 * navigation theme, light unless a dark theme is provided, so with none a bar
 * drew its glass, title and buttons light over a dark screen; each stack
 * names the window's scheme instead (`headerUserInterfaceStyle`).
 */
export function useBarScheme(): BarScheme {
  return useColorScheme() === "dark" ? "dark" : "light";
}

/** The ink a tone is drawn in. */
export function toneColor(colors: BrandColors, tone: StatusTone): string {
  return colors[TONE_ROLE[tone]];
}

// brand-palette.mjs -- the brand's colors, the one table both generators read.
//
// generate-surface-shared.mjs writes these onto @repo/ui's roles (brand.css)
// and as plain values (BRAND_PALETTE); generate-brand-assets.mjs draws the
// icons, the cards, and the buttons in them.

// The brand's colors: every --ui-color-* role a change of brand changes,
// in the light theme and the dark, for the desktop and the site alike. The
// roles a brand leaves alone (the fills and edges drawn as alphas of the ink,
// shadows, the chart hues, find's yellows) stay in @repo/ui's palettes.css,
// but for the identity hues below, which the iOS app draws too. Each entry is one brand; `BRAND` names the one the product
// wears, so a rebrand is a new entry and that one name, and a second theme
// is a second entry the generator writes under a selector of its own.
//
// Copper: warm graphite neutrals and one copper accent at 60 degrees of
// OKLCH hue, held there in the dark rather than lightened toward peach. Every
// ink holds its contrast pair on the grounds it is drawn on, which
// @repo/ui's brand-contrast.test.ts asserts.
//
// Note that there is one copper, and it means you: the brand, what you can
// act on, and what waits on you (attention) are the same ink, so attention
// names the accent's values rather than a second copper a step away. Work
// under way is the one status that would otherwise share it, so it is a blue
// of its own at 250 degrees, at the other status inks' lightness, and a
// running agent reads apart from one that needs you.
const COPPER = {
  LIGHT: { FILL: "#a7611b", INK: "#8e5323" },
  DARK: { FILL: "#cf7b26", INK: "#f19a4b" },
};

// The product's avatar as GitHub shows the App's bot, cut as
// assets/avatar/avatar-dark.svg: copper on the night tile. It is a picture
// of something else's, so it is the same in either theme, and the window
// draws it from these where it shows how a commit reads on GitHub.
const AVATAR = { TILE: "#171412", INK: COPPER.DARK.FILL };

// Geist: Vercel's design system (https://vercel.com/geist/colors), its
// neutral grays and backgrounds verbatim, and its amber-900 as the one
// accent: a burnt orange in the light theme and amber-800's orange in the
// dark, where Geist's 900 step is the same color. Each role takes the step
// Geist names for it: background-100 the ground and background-200 the
// frame and the wells, gray-100 to 300 a control's rest, hover, and press,
// gray-400 and 500 its edges, gray-900 the secondary words and gray-1000 the
// primary. A status ink is its scale's 900, Geist's accessible text step.
// Attention shares the accent, as copper's did; work under way is Geist's
// blue and a start its teal, so neither reads as the accent.
//
// Note that words on the dark fill are gray-1000, since white reads on that
// orange at under 2:1, and attention's fill and its words are the accent's,
// so one orange means the same in every place it is drawn.
const GEIST_AMBER = {
  LIGHT: { AMBER_900: "#a64f00", ON: "#ffffff" },
  DARK: { AMBER_900: "#ff9900", ON: "#171717" },
};

const BRAND_PALETTES = {
  COPPER: {
    LIGHT: {
      GROUND: "#fffcfa",
      SURFACE: "#ffffff",
      OVERLAY: "#ffffff",
      SIDEBAR: "#f5f2f0",
      SIDEBAR_INK: "#575553",
      WELL: "#f9f6f4",
      CODE_GROUND: "#ffffff",
      CHIP: "#ffffff",
      CHIP_HOVER: "#f8f5f3",
      CHIP_SELECTED: "#f0edeb",
      CHIP_EDGE: "#e1dedc",
      CHIP_EDGE_STRONG: "#b1aeac",
      INK: "#080706",
      TEXT: "#171614",
      TEXT_BODY: "#282624",
      TEXT_MUTED: "#64615f",
      ACCENT: COPPER.LIGHT.FILL,
      ON_ACCENT: "#ffffff",
      ON_ACCENT_MUTED: "#ffffff",
      ACCENT_TEXT: COPPER.LIGHT.INK,
      FOCUS_RING: COPPER.LIGHT.FILL,
      SWITCH_ON: COPPER.LIGHT.FILL,
      DANGER: "#e23242",
      DANGER_TEXT: "#b42e36",
      DANGER_FILL: "#db3643",
      ATTENTION: COPPER.LIGHT.INK,
      ATTENTION_FILL: COPPER.LIGHT.FILL,
      WORKING: "#1666aa",
      STARTING: "#8a6a00",
      COMPLETE: "#067040",
      MERGED: "#744caf",
      AVATAR_TILE: AVATAR.TILE,
      AVATAR_INK: AVATAR.INK,
    },
    DARK: {
      GROUND: "#0f0d0b",
      SURFACE: "#120f0d",
      OVERLAY: "#171412",
      SIDEBAR: "#060504",
      SIDEBAR_INK: "#a5a19e",
      WELL: "#090706",
      CODE_GROUND: "#090706",
      CHIP: "#181513",
      CHIP_HOVER: "#1f1c1a",
      CHIP_SELECTED: "#262321",
      CHIP_EDGE: "#221f1d",
      CHIP_EDGE_STRONG: "#383532",
      INK: "#fffdfc",
      TEXT: "#f4f1ef",
      TEXT_BODY: "#e0dddb",
      TEXT_MUTED: "#96918d",
      ACCENT: COPPER.DARK.FILL,
      ON_ACCENT: "#120f0d",
      ON_ACCENT_MUTED: "#120f0d",
      ACCENT_TEXT: COPPER.DARK.INK,
      FOCUS_RING: COPPER.DARK.FILL,
      SWITCH_ON: COPPER.DARK.FILL,
      DANGER: "#fb817f",
      DANGER_TEXT: "#fe908d",
      DANGER_FILL: "#db3643",
      ATTENTION: COPPER.DARK.INK,
      // White words sit on attention's fill in either theme, and the dark
      // accent is too light to hold them, so the fill is the light one.
      ATTENTION_FILL: COPPER.LIGHT.FILL,
      WORKING: "#76bafe",
      STARTING: "#f2c94c",
      COMPLETE: "#56d089",
      MERGED: "#c29fff",
      AVATAR_TILE: AVATAR.TILE,
      AVATAR_INK: AVATAR.INK,
    },
  },
  GEIST: {
    LIGHT: {
      GROUND: "#ffffff",
      SURFACE: "#ffffff",
      OVERLAY: "#ffffff",
      SIDEBAR: "#fafafa",
      SIDEBAR_INK: "#4d4d4d",
      WELL: "#fafafa",
      CODE_GROUND: "#fafafa",
      CHIP: "#ffffff",
      CHIP_HOVER: "#f2f2f2",
      CHIP_SELECTED: "#ebebeb",
      CHIP_EDGE: "#ebebeb",
      CHIP_EDGE_STRONG: "#c9c9c9",
      INK: "#000000",
      TEXT: "#171717",
      TEXT_BODY: "#171717",
      TEXT_MUTED: "#4d4d4d",
      ACCENT: GEIST_AMBER.LIGHT.AMBER_900,
      ON_ACCENT: GEIST_AMBER.LIGHT.ON,
      ON_ACCENT_MUTED: GEIST_AMBER.LIGHT.ON,
      ACCENT_TEXT: GEIST_AMBER.LIGHT.AMBER_900,
      FOCUS_RING: GEIST_AMBER.LIGHT.AMBER_900,
      SWITCH_ON: GEIST_AMBER.LIGHT.AMBER_900,
      DANGER: "#d60020",
      DANGER_TEXT: "#d60020",
      DANGER_FILL: "#d60020",
      ATTENTION: GEIST_AMBER.LIGHT.AMBER_900,
      ATTENTION_FILL: GEIST_AMBER.LIGHT.AMBER_900,
      WORKING: "#0064e2",
      STARTING: "#007a6e",
      COMPLETE: "#107d32",
      MERGED: "#7c00c9",
      AVATAR_TILE: AVATAR.TILE,
      AVATAR_INK: AVATAR.INK,
    },
    DARK: {
      GROUND: "#0a0a0a",
      SURFACE: "#0a0a0a",
      OVERLAY: "#1a1a1a",
      SIDEBAR: "#000000",
      SIDEBAR_INK: "#a1a1a1",
      WELL: "#000000",
      CODE_GROUND: "#000000",
      CHIP: "#1a1a1a",
      CHIP_HOVER: "#1f1f1f",
      CHIP_SELECTED: "#292929",
      CHIP_EDGE: "#2e2e2e",
      CHIP_EDGE_STRONG: "#454545",
      INK: "#ffffff",
      TEXT: "#ededed",
      TEXT_BODY: "#ededed",
      TEXT_MUTED: "#a1a1a1",
      ACCENT: GEIST_AMBER.DARK.AMBER_900,
      ON_ACCENT: GEIST_AMBER.DARK.ON,
      ON_ACCENT_MUTED: GEIST_AMBER.DARK.ON,
      ACCENT_TEXT: GEIST_AMBER.DARK.AMBER_900,
      FOCUS_RING: GEIST_AMBER.DARK.AMBER_900,
      SWITCH_ON: GEIST_AMBER.DARK.AMBER_900,
      DANGER: "#ff5e63",
      DANGER_TEXT: "#ff5e63",
      DANGER_FILL: "#e2162a",
      ATTENTION: GEIST_AMBER.DARK.AMBER_900,
      ATTENTION_FILL: GEIST_AMBER.DARK.AMBER_900,
      WORKING: "#50a8ff",
      STARTING: "#00c9b5",
      COMPLETE: "#00ca52",
      MERGED: "#c472fb",
      AVATAR_TILE: AVATAR.TILE,
      AVATAR_INK: AVATAR.INK,
    },
  },
};

// The brand the window, the site, and the iOS app wear.
export const BRAND = BRAND_PALETTES.GEIST;

// The brand the cut artwork wears: the icon, the mark, the cards, and the
// DMG's ground, which generate-brand-assets.mjs draws. Note that it stays
// copper while Geist is tried on the surfaces, so the trial redraws no
// committed artwork.
export const ARTWORK_BRAND = BRAND_PALETTES.COPPER;

// A person's disc and a workspace's tile: six muted hues read off an id
// (@repo/features/workspace-tile's identityHue, from 1), each holding its
// white letter at AA on either ground. None is copper, so no one's disc reads
// as attention's beside a row. No brand changes them, but the window
// (identity.css) and the iOS app (identity-hues.ts) both draw them, so they
// are written from here rather than kept twice.
export const IDENTITY = {
  LIGHT: ["#4a5fc0", "#23766f", "#237293", "#a8435f", "#6a4fbd", "#3f7434"],
  DARK: ["#4f63b8", "#2b7f78", "#2a7899", "#a24a63", "#6c55b3", "#477a3a"],
  // The letter's ink on every hue.
  ON: "#ffffff",
};

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
import { GEIST_BLACK, GEIST_WHITE, geistTheme } from "./geist.mjs";

const COPPER = {
  LIGHT: { FILL: "#a7611b", INK: "#8e5323" },
  DARK: { FILL: "#cf7b26", INK: "#f19a4b" },
};

// The product's avatar as GitHub shows the App's bot, cut as
// assets/avatar/avatar-dark.svg: copper on the night tile. It is a picture
// of something else's, so it is the same in either theme, and the window
// draws it from these where it shows how a commit reads on GitHub.
const AVATAR = { TILE: "#171412", INK: COPPER.DARK.FILL };

// Geist (geist.mjs): every role names a step of Geist's, its grays and
// backgrounds for the grounds and the words and its amber-900 for the one
// accent: a burnt orange in the light theme and an orange in the dark. Each
// role takes the step Geist names for it: background-100 the ground and
// background-200 the frame and the wells, gray-100 to 300 a control's rest,
// hover, and press, gray-400 and 500 its edges, gray-900 the secondary
// words and gray-1000 the primary. A status ink is its scale's 900, Geist's
// accessible text step. Attention shares the accent, as copper's did, and so
// does a start, which copper drew in a yellow Geist has no scale for; work
// under way is Geist's blue, as it was copper's.
//
// A card (the surface) is the ground's own background-100 in the light
// theme, standing off it by Geist's card shadow, and gray-100 in the dark,
// where a shadow falls black on black, so it stands off the ground by its
// fill.
//
// Note that words on the dark fill are the light theme's gray-1000, since
// white reads on that orange at under 2:1, and attention's fill and its
// words are the accent's, so one orange means the same in every place it is
// drawn.
const GEIST_LIGHT = geistTheme("LIGHT");
const GEIST_DARK = geistTheme("DARK");

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
      GROUND: GEIST_LIGHT.BACKGROUND[100],
      SURFACE: GEIST_LIGHT.BACKGROUND[100],
      OVERLAY: GEIST_LIGHT.BACKGROUND[100],
      SIDEBAR: GEIST_LIGHT.BACKGROUND[200],
      SIDEBAR_INK: GEIST_LIGHT.GRAY[900],
      WELL: GEIST_LIGHT.BACKGROUND[200],
      CODE_GROUND: GEIST_LIGHT.BACKGROUND[200],
      CHIP: GEIST_LIGHT.BACKGROUND[100],
      CHIP_HOVER: GEIST_LIGHT.GRAY[100],
      CHIP_SELECTED: GEIST_LIGHT.GRAY[200],
      CHIP_EDGE: GEIST_LIGHT.GRAY[400],
      CHIP_EDGE_STRONG: GEIST_LIGHT.GRAY[500],
      INK: GEIST_BLACK,
      TEXT: GEIST_LIGHT.GRAY[1000],
      TEXT_BODY: GEIST_LIGHT.GRAY[1000],
      TEXT_MUTED: GEIST_LIGHT.GRAY[900],
      ACCENT: GEIST_LIGHT.AMBER[900],
      ON_ACCENT: GEIST_WHITE,
      ON_ACCENT_MUTED: GEIST_WHITE,
      ACCENT_TEXT: GEIST_LIGHT.AMBER[900],
      FOCUS_RING: GEIST_LIGHT.AMBER[900],
      SWITCH_ON: GEIST_LIGHT.AMBER[900],
      DANGER: GEIST_LIGHT.RED[900],
      DANGER_TEXT: GEIST_LIGHT.RED[900],
      DANGER_FILL: GEIST_LIGHT.RED[900],
      ATTENTION: GEIST_LIGHT.AMBER[900],
      ATTENTION_FILL: GEIST_LIGHT.AMBER[900],
      WORKING: GEIST_LIGHT.BLUE[900],
      STARTING: GEIST_LIGHT.AMBER[900],
      COMPLETE: GEIST_LIGHT.GREEN[900],
      MERGED: GEIST_LIGHT.PURPLE[900],
      AVATAR_TILE: AVATAR.TILE,
      AVATAR_INK: AVATAR.INK,
    },
    DARK: {
      GROUND: GEIST_DARK.BACKGROUND[100],
      SURFACE: GEIST_DARK.GRAY[100],
      OVERLAY: GEIST_DARK.GRAY[100],
      SIDEBAR: GEIST_DARK.BACKGROUND[200],
      SIDEBAR_INK: GEIST_DARK.GRAY[900],
      WELL: GEIST_DARK.BACKGROUND[200],
      CODE_GROUND: GEIST_DARK.BACKGROUND[200],
      CHIP: GEIST_DARK.GRAY[100],
      CHIP_HOVER: GEIST_DARK.GRAY[200],
      CHIP_SELECTED: GEIST_DARK.GRAY[300],
      CHIP_EDGE: GEIST_DARK.GRAY[400],
      CHIP_EDGE_STRONG: GEIST_DARK.GRAY[500],
      INK: GEIST_WHITE,
      TEXT: GEIST_DARK.GRAY[1000],
      TEXT_BODY: GEIST_DARK.GRAY[1000],
      TEXT_MUTED: GEIST_DARK.GRAY[900],
      ACCENT: GEIST_DARK.AMBER[900],
      ON_ACCENT: GEIST_LIGHT.GRAY[1000],
      ON_ACCENT_MUTED: GEIST_LIGHT.GRAY[1000],
      ACCENT_TEXT: GEIST_DARK.AMBER[900],
      FOCUS_RING: GEIST_DARK.AMBER[900],
      SWITCH_ON: GEIST_DARK.AMBER[900],
      DANGER: GEIST_DARK.RED[900],
      DANGER_TEXT: GEIST_DARK.RED[900],
      DANGER_FILL: GEIST_DARK.RED[800],
      ATTENTION: GEIST_DARK.AMBER[900],
      ATTENTION_FILL: GEIST_DARK.AMBER[900],
      WORKING: GEIST_DARK.BLUE[900],
      STARTING: GEIST_DARK.AMBER[900],
      COMPLETE: GEIST_DARK.GREEN[900],
      MERGED: GEIST_DARK.PURPLE[900],
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

#!/usr/bin/env node
// Shared surface vocabulary — the single source for the tokens, marks, labels,
// and window-layout sizes both the desktop renderer and the marketing mock
// draw from.
//
//   node packages/brand/scripts/generate-surface-shared.mjs
//
// It writes four committed outputs into packages/brand/src/generated, four
// into @repo/ui's tokens, and three into @repo/ui-native's, all from the
// tables further down:
//
//   src/motion-tokens.ts        the same durations and sizes, as numbers
//   src/provider-mark-paths.ts  SVG path data for the sign-in provider marks
//   src/brand-palette.ts        the brand's colors as plain values
//   src/lucide-symbols.ts       Lucide's glyphs as SF Symbols templates, outlined
//   ui/src/tokens/motion-tokens.css  the --ui-* motion tokens the shared
//                               components read, imported by @repo/ui/tokens.css
//   ui/src/tokens/geist.css     Geist's steps as --geist-* properties
//   ui/src/tokens/brand.css     the brand's colors on the --ui-color-* roles
//   ui/src/tokens/identity.css  the identity hues on --ui-color-identity-*
//   ui-native/src/tokens/brand-colors.ts  the iOS app's share of those
//                               colors, as values SwiftUI is handed
//   ui-native/src/tokens/identity-hues.ts  the same identity hues, as values
//   ui-native/src/tokens/lucide-symbols.ts  the names the iOS app's asset
//                               catalog holds those templates under
//
// The React that traces the marks, and the rules that consume the tokens, stay
// in each app: a shared component would pull desktop-only code into the web
// bundle. Emitting the data from here keeps the second copy from being a
// second source. `--check` reports drift when run by hand.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BRAND, IDENTITY } from "./brand-palette.mjs";
import { GEIST } from "./geist.mjs";
import { symbolTemplate } from "./lucide-symbols.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SURFACE = join(HERE, "..", "src", "generated");
const UI_TOKENS = join(HERE, "..", "..", "ui", "src", "tokens");
const UI_NATIVE_TOKENS = join(HERE, "..", "..", "ui-native", "src", "tokens");
const UI_MANIFEST = join(HERE, "..", "..", "ui", "package.json");

// ---------- Motion tokens ----------
// Sampled damped springs, one duration. A real spring's motion is a property
// of the spring, not of how far it is asked to travel, which is why the same
// samples serve a short travel and a long one.
const SPRING = [
  0, 0.0285, 0.0993, 0.1943, 0.3005, 0.4083, 0.5115, 0.6061, 0.69, 0.7623, 0.8229, 0.8727, 0.9125,
  0.9437, 0.9674, 0.9848, 0.9972, 1.0056, 1.0109, 1.0138, 1.015, 1.015, 1.0142, 1.0129, 1.0114,
  1.0098, 1,
];

// The same damping ratio; only the frequency changes, which is what a smaller
// and lighter element wants.
const SPRING_FAST = [
  0, 0.0288, 0.1002, 0.1961, 0.3029, 0.4113, 0.5149, 0.6097, 0.6935, 0.7656, 0.826, 0.8755, 0.9149,
  0.9457, 0.969, 0.9861, 0.9982, 1.0063, 1.0113, 1.014, 1.0151, 1.015, 1.0141, 1.0127, 1.0112,
  1.0095, 1,
];

const MOTION_DURATION_MS = {
  FAST: 280,
  SPRING: 460,
  EXIT: 90,
  QUICK: 140,
  HOVER: 70,
  PANE: 240,
  // Motion a reader watches rather than waits on, as the landing's hero
  // plays the Inbox: long enough to follow, eased in as well as out.
  SHOWCASE: 1000,
};

const MOTION_DELAY_MS = {
  ROW_STAGGER: 32,
  // How long a pointer rests on a control before its hover hint shows.
  HINT: 500,
  // How long a state that often heals at once (a dropped connection being
  // made again) holds before it is shown, so a blip is never seen.
  LATE: 1000,
  // How long a confirmation that a write landed (an autosave's Saved)
  // stands before it fades.
  CONFIRM: 1200,
  // How long a flash over a video answering a key (an arrow's jump, a
  // speed change) stands before it fades: shorter than a confirmation,
  // because keys pressed in a run each start it over.
  FLASH: 800,
  // A beat to see whether a state settles before it is acted on: a hover
  // card standing after the pointer leaves it, a spinner's ring waiting to see
  // whether a read lands at once.
  SETTLE: 180,
};

const MOTION_EXIT = "cubic-bezier(0.4, 0, 0.6, 1)";

// The desktop window's panes (the sidebar, the side panel) open and close on
// a plain ease-out rather than the spring: a pane stands on the window's own
// edge, and a spring's overshoot would part the two for a frame.
const MOTION_PANE = "cubic-bezier(0.2, 0, 0, 1)";

// ---------- Brand palette ----------
// The brand's colors live in brand-palette.mjs, which the asset generator
// reads too; this script writes them onto @repo/ui's roles and as values.

// The roles the iOS app draws with: the accent, the grounds a screen, a list,
// and a sidebar stand on, the inks, and the status inks. The rest (a chip's
// hover, a focus ring) are the desktop's and the site's, which SwiftUI's own
// control states stand in for on iOS.
const NATIVE_ROLES = [
  "ACCENT",
  "ON_ACCENT",
  "ACCENT_TEXT",
  "GROUND",
  "SURFACE",
  "SIDEBAR",
  "SIDEBAR_INK",
  "WELL",
  "CHIP_EDGE",
  "TEXT",
  "TEXT_BODY",
  "TEXT_MUTED",
  "DANGER",
  "DANGER_TEXT",
  "ATTENTION",
  "ATTENTION_FILL",
  "WORKING",
  "COMPLETE",
  "MERGED",
  "AVATAR_TILE",
  "AVATAR_INK",
];

// ---------- Provider mark paths ----------
// Each is the provider's own mark, reproduced rather than redrawn. Attribution
// lives with the React that traces them; this table is only the geometry.
const MARK_PATHS = {
  /*
   * GitHub's Octocat mark, verbatim from the invertocat GitHub publishes, on
   * its 16-unit canvas. Drawn wherever a GitHub sign-in names itself: the
   * account row and the loopback landing page.
   */
  /*
   * Claude Code's Clawd, verbatim from `resources/clawd.svg` in Anthropic's
   * own Claude Code extension for VS Code, on its 47 by 38 canvas, filled in
   * its own clay, #D97757. Drawn wherever an agent on Claude Code
   * names itself: the panel's harness mark and the iOS app's agent tile.
   */
  CLAWD:
    "M5.08191 10.0769V0.938461H9.37422V10.0769H5.08191ZM9.23305 10.0769V0.938461H13.5254V10.0769H9.23305ZM13.3842 10.0769V0.938461H17.6765V10.0769H13.3842ZM17.5353 10.0769V0.938461H21.8276V10.0769H17.5353ZM21.6865 10.0769V0.938461H25.9788V10.0769H21.6865ZM25.8376 10.0769V0.938461H30.1299V10.0769H25.8376ZM29.9888 10.0769V0.938461H34.2811V10.0769H29.9888ZM34.1399 10.0769V0.938461H38.4322V10.0769H34.1399ZM38.291 10.0769V0.938461H42.5834V10.0769H38.291ZM0.930769 19.0769V9.93846H5.22308V19.0769H0.930769ZM5.08191 19.0769V9.93846H9.37422V19.0769H5.08191ZM9.23305 19.0769V14.5077H13.5254V19.0769H9.23305ZM13.3842 19.0769V9.93846H17.6765V19.0769H13.3842ZM17.5353 19.0769V9.93846H21.8276V19.0769H17.5353ZM21.6865 19.0769V9.93846H25.9788V19.0769H21.6865ZM25.8376 19.0769V9.93846H30.1299V19.0769H25.8376ZM29.9888 19.0769V9.93846H34.2811V19.0769H29.9888ZM34.1399 19.0769V14.5077H38.4322V19.0769H34.1399ZM38.291 19.0769V9.93846H42.5834V19.0769H38.291ZM42.4422 19.0769V9.93846H46.7345V19.0769H42.4422ZM5.08191 28.0769V18.9385H9.37422V28.0769H5.08191ZM9.23305 28.0769V18.9385H13.5254V28.0769H9.23305ZM13.3842 28.0769V18.9385H17.6765V28.0769H13.3842ZM17.5353 28.0769V18.9385H21.8276V28.0769H17.5353ZM21.6865 28.0769V18.9385H25.9788V28.0769H21.6865ZM25.8376 28.0769V18.9385H30.1299V28.0769H25.8376ZM29.9888 28.0769V18.9385H34.2811V28.0769H29.9888ZM34.1399 28.0769V18.9385H38.4322V28.0769H34.1399ZM38.291 28.0769V18.9385H42.5834V28.0769H38.291ZM5.08191 37.0769V27.9385H9.37422V37.0769H5.08191ZM13.3842 37.0769V27.9385H17.6765V37.0769H13.3842ZM29.9888 37.0769V27.9385H34.2811V37.0769H29.9888ZM38.291 37.0769V27.9385H42.5834V37.0769H38.291Z",
  GITHUB:
    "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z",
};

const GOOGLE_MARK_LAYERS = [
  {
    fill: "#4285F4",
    path: "M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z",
  },
  {
    fill: "#34A853",
    path: "M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z",
  },
  {
    fill: "#FBBC05",
    path: "M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z",
  },
  {
    fill: "#EA4335",
    path: "M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z",
  },
];

// ---------- Lucide symbols ----------
// The panel's Lucide glyphs for the marks that are our own and that SF
// Symbols has no drawing of, under the names the iOS app's asset catalog
// holds them by: a pull request in each state, a branch, and a decide ask.
// Every other glyph the app draws is an SF Symbol.
const LUCIDE_SYMBOLS = {
  GIT_PULL_REQUEST: "git-pull-request",
  GIT_PULL_REQUEST_DRAFT: "git-pull-request-draft",
  GIT_PULL_REQUEST_CLOSED: "git-pull-request-closed",
  GIT_MERGE: "git-merge",
  GIT_BRANCH: "git-branch",
  SPLIT: "split",
};

// Note that the drawings are read from the lucide-react @repo/ui resolves,
// so the phone's glyphs are the panel's at the very version it pins, and
// brand declares no second copy beside it.
const lucideFrom = createRequire(UI_MANIFEST);

// The asset's name: Lucide's own component name, "git-merge" as "GitMerge".
const assetName = (icon) => icon.replace(/(?:^|-)([a-z0-9])/g, (_, letter) => letter.toUpperCase());

const lucideSymbols = await Promise.all(
  Object.entries(LUCIDE_SYMBOLS).map(async ([key, icon]) => {
    const module = lucideFrom.resolve(`lucide-react/dist/esm/icons/${icon}.mjs`);
    const { __iconData } = await import(pathToFileURL(module).href);

    return { key, name: assetName(icon), svg: symbolTemplate(__iconData.node) };
  }),
);

// ---------- Emission ----------
const CHECK_ONLY = process.argv.includes("--check");
const written = [];
const stale = [];

function put(path, content) {
  if (CHECK_ONLY) {
    const current = existsSync(path) ? readFileSync(path, "utf8") : undefined;

    if (current !== content) stale.push(path);

    return;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function linearCss(samples) {
  return `linear(\n    ${samples.join(",\n    ")}\n  )`;
}

function ms(value) {
  return `${value}ms`;
}

// Note that the motion vocabulary is @repo/ui's alone, under its --ui-*
// names: every app that loads its tokens moves a spring, a duration, or a
// delay alike, and there is no second set beside it.
function uiMotionTokensCss() {
  return `/* Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
   the tables in that script and re-run it.

   The motion every surface reads: brand's springs, durations, and
   delays under @repo/ui's names, so every app that imports
   @repo/ui/tokens.css moves them alike. motion.css answers reduced motion. */

:root {
  --ui-spring: ${linearCss(SPRING)};
  --ui-spring-fast: ${linearCss(SPRING_FAST)};
  --ui-duration-hover: ${ms(MOTION_DURATION_MS.HOVER)};
  --ui-duration-exit: ${ms(MOTION_DURATION_MS.EXIT)};
  --ui-duration-quick: ${ms(MOTION_DURATION_MS.QUICK)};
  --ui-duration-pane: ${ms(MOTION_DURATION_MS.PANE)};
  --ui-duration-fast: ${ms(MOTION_DURATION_MS.FAST)};
  --ui-duration-shape: ${ms(MOTION_DURATION_MS.SPRING)};
  --ui-duration-showcase: ${ms(MOTION_DURATION_MS.SHOWCASE)};
  --ui-motion-exit: ${MOTION_EXIT};
  --ui-motion-pane: ${MOTION_PANE};
  --ui-row-stagger: ${ms(MOTION_DELAY_MS.ROW_STAGGER)};
  --ui-hint-delay: ${ms(MOTION_DELAY_MS.HINT)};
  --ui-late-delay: ${ms(MOTION_DELAY_MS.LATE)};
  --ui-confirm-delay: ${ms(MOTION_DELAY_MS.CONFIRM)};
  --ui-flash-delay: ${ms(MOTION_DELAY_MS.FLASH)};
  --ui-settle-delay: ${ms(MOTION_DELAY_MS.SETTLE)};
}
`;
}

function tsRecord(entries, indent = "  ") {
  return entries.map(([key, value]) => `${indent}${key}: ${value},`).join("\n");
}

function motionTokensTs() {
  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in that script and re-run it.
//
// Millisecond mirrors of the CSS duration tokens in motion-tokens.css, from the
// same table. A main-process constant that waits on a CSS total names these
// rather than restating the numbers.

export const MOTION_DURATION_MS = {
${tsRecord(Object.entries(MOTION_DURATION_MS).map(([key, value]) => [key, value]))}
} as const;

export const MOTION_DELAY_MS = {
${tsRecord(Object.entries(MOTION_DELAY_MS).map(([key, value]) => [key, value]))}
} as const;
`;
}

function tsStringConst(name, value) {
  const single = `export const ${name} = "${value}";`;

  return single.length <= 100 ? single : `export const ${name} =\n  "${value}";`;
}

function providerMarkPathsTs() {
  const pathConsts = Object.entries(MARK_PATHS)
    .map(([name, path]) => tsStringConst(`${name}_PATH`, path))
    .join("\n\n");

  // One property per line, matching the shape Biome would format these to —
  // the emitted file is committed and linted, so the two must agree exactly.
  const google = GOOGLE_MARK_LAYERS.map(
    (layer) => `  {\n    fill: "${layer.fill}",\n    path: "${layer.path}",\n  },`,
  ).join("\n");

  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in that script and re-run it.
//
// SVG path data for the marks a sign-in or an agent's harness names itself by.
// The React that traces them stays in each app.

${pathConsts}

// Google's "G" sign-in mark, drawn as filled layers in an 18×18 box.
export const GOOGLE_MARK_LAYERS: readonly { fill: string; path: string }[] = [
${google}
];
`;
}

function lucideSymbolsTs() {
  const templates = lucideSymbols
    .map(({ name, svg }) => `  {\n    name: "${name}",\n    svg: '${svg}',\n  },`)
    .join("\n");

  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in that script and re-run it.
//
// Lucide's glyphs as SF Symbols custom symbol templates, their strokes
// outlined in three weights iOS interpolates (scripts/lucide-symbols.mjs),
// which the iOS app's config writes into its asset catalog as symbol sets.

export const LUCIDE_SYMBOL_TEMPLATES: readonly { name: string; svg: string }[] = [
${templates}
];
`;
}

function nativeLucideSymbolsTs() {
  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in that script and re-run it.
//
// The names the iOS app's asset catalog holds Lucide's glyphs under, as
// symbol sets the app's config writes from @repo/brand's templates.

export const LUCIDE_SYMBOL = {
${tsRecord(lucideSymbols.map(({ key, name }) => [key, `"${name}"`]))}
} as const;
`;
}

// The brand's roles under their --ui-color-* names: the desktop writes each
// once as light-dark(), as palettes.css does, and the site a block per theme,
// for browsers older than light-dark().
const roleName = (key) => `--ui-color-${key.toLowerCase().replaceAll("_", "-")}`;

function uiBrandCss() {
  const keys = Object.keys(BRAND.LIGHT);

  const pair = (key) =>
    BRAND.LIGHT[key] === BRAND.DARK[key]
      ? BRAND.LIGHT[key]
      : `light-dark(${BRAND.LIGHT[key]}, ${BRAND.DARK[key]})`;

  const block = (value) => keys.map((key) => `  ${roleName(key)}: ${value(key)};`).join("\n");

  return `/* Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
   the tables in that script and re-run it.

   The brand's colors on @repo/ui's roles, both profiles, both themes. The
   roles no brand changes are palettes.css's. */

[data-ui-profile="desktop"] {
${block(pair)}
}

[data-ui-profile="web"],
[data-ui-profile="web"][data-ui-theme="light"] {
${block((key) => BRAND.LIGHT[key])}
}

[data-ui-profile="web"][data-ui-theme="dark"] {
${block((key) => BRAND.DARK[key])}
}

/* The accent over a ground no theme chooses, someone else's page, where the
   agent's pointer is drawn: the light theme's over a light page and the dark
   theme's over a dark one, whatever the window's own theme. */
[data-ui-profile] {
  --ui-color-accent-on-light: ${BRAND.LIGHT.ACCENT};
  --ui-color-accent-on-dark: ${BRAND.DARK.ACCENT};
}
`;
}

// Geist's steps under --geist-<scale>-<step> names, laid out as brand.css
// lays out the brand's: once as light-dark() on the desktop, and a block per
// theme on the site. palettes.css names these rather than writing a hex.
function uiGeistCss() {
  const steps = Object.entries(GEIST).flatMap(([scale, values]) =>
    Object.entries(values).map(([at, colors]) => [
      `--geist-${scale.toLowerCase().replaceAll("_", "-")}-${at}`,
      colors,
    ]),
  );

  const block = (value) => steps.map(([name, colors]) => `  ${name}: ${value(colors)};`).join("\n");
  const pair = (colors) =>
    colors.LIGHT === colors.DARK ? colors.LIGHT : `light-dark(${colors.LIGHT}, ${colors.DARK})`;

  return `/* Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
   geist.mjs and re-run it.

   Geist's colors (https://vercel.com/geist/colors), every step of every
   scale, both profiles, both themes. A role names one of these; none is
   drawn with directly. */

[data-ui-profile="desktop"] {
${block(pair)}
}

[data-ui-profile="web"],
[data-ui-profile="web"][data-ui-theme="light"] {
${block((colors) => colors.LIGHT)}
}

[data-ui-profile="web"][data-ui-theme="dark"] {
${block((colors) => colors.DARK)}
}
`;
}

// The identity hues under --ui-color-identity-1 through -6, laid out as
// brand.css lays out the brand's: once as light-dark() on the desktop, and a
// block per theme on the site.
function uiIdentityCss() {
  const block = (value) =>
    [
      ...IDENTITY.LIGHT.map((_, index) => `  --ui-color-identity-${index + 1}: ${value(index)};`),
      `  --ui-color-on-identity: ${IDENTITY.ON};`,
    ].join("\n");

  const pair = (index) =>
    IDENTITY.LIGHT[index] === IDENTITY.DARK[index]
      ? IDENTITY.LIGHT[index]
      : `light-dark(${IDENTITY.LIGHT[index]}, ${IDENTITY.DARK[index]})`;

  return `/* Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
   the IDENTITY table in brand-palette.mjs and re-run it.

   A person's disc (\`avatar.tsx\`) and a workspace's tile: six muted hues
   read off an id, each holding its white letter at AA on either ground. None
   is copper, so no one's disc reads as attention's beside a row. The iOS
   app's tile draws the same values (@repo/ui-native's identity-hues.ts). */

[data-ui-profile="desktop"] {
${block(pair)}
}

[data-ui-profile="web"],
[data-ui-profile="web"][data-ui-theme="light"] {
${block((index) => IDENTITY.LIGHT[index])}
}

[data-ui-profile="web"][data-ui-theme="dark"] {
${block((index) => IDENTITY.DARK[index])}
}
`;
}

function brandPaletteTs() {
  const theme = (values) =>
    tsRecord(
      Object.entries(values).map(([key, value]) => [key, `"${value}"`]),
      "    ",
    );

  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in that script and re-run it.
//
// The brand's colors as plain values, from the table @repo/ui's brand.css
// is written from, for what reads no custom property: an email, a check of
// the palette's contrast.

export const BRAND_PALETTE = {
  LIGHT: {
${theme(BRAND.LIGHT)}
  },
  DARK: {
${theme(BRAND.DARK)}
  },
} as const;
`;
}

// Note that iOS reads no custom property, so the app's colors are values in
// either theme, which @repo/ui-native picks between by the color scheme.
function nativeBrandColorsTs() {
  const theme = (values) =>
    tsRecord(
      NATIVE_ROLES.map((key) => [key, `"${values[key]}"`]),
      "    ",
    );

  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in that script and re-run it.
//
// The brand's colors the iOS app draws with, from the table @repo/ui's
// brand.css is written from, in the light theme and the dark.

export const BRAND_COLOR = {
  LIGHT: {
${theme(BRAND.LIGHT)}
  },
  DARK: {
${theme(BRAND.DARK)}
  },
} as const;
`;
}

// Note that the hues are kept in @repo/features/workspace-tile's order, so
// identityHue's 1 is the first of each list.
function nativeIdentityHuesTs() {
  const hues = (values) => `[${values.map((value) => `"${value}"`).join(", ")}]`;

  return `// Generated by packages/brand/scripts/generate-surface-shared.mjs. Do not edit by hand: change
// the IDENTITY table in brand-palette.mjs and re-run it.
//
// The six hues a workspace's letter stands on, by the hue
// @repo/features/workspace-tile's identityHue reads off its id, in the light
// theme and the dark: the same values @repo/ui's identity.css names
// --ui-color-identity-1 through -6.

export const IDENTITY_HUE = {
  LIGHT: ${hues(IDENTITY.LIGHT)},
  DARK: ${hues(IDENTITY.DARK)},
} as const;

// The letter's ink on every hue.
export const ON_IDENTITY = "${IDENTITY.ON}";
`;
}

const outputs = [
  [join(SURFACE, "motion-tokens.ts"), motionTokensTs()],
  [join(SURFACE, "provider-mark-paths.ts"), providerMarkPathsTs()],
  [join(UI_TOKENS, "motion-tokens.css"), uiMotionTokensCss()],
  [join(SURFACE, "brand-palette.ts"), brandPaletteTs()],
  [join(UI_TOKENS, "geist.css"), uiGeistCss()],
  [join(UI_TOKENS, "brand.css"), uiBrandCss()],
  [join(UI_NATIVE_TOKENS, "brand-colors.ts"), nativeBrandColorsTs()],
  [join(UI_TOKENS, "identity.css"), uiIdentityCss()],
  [join(UI_NATIVE_TOKENS, "identity-hues.ts"), nativeIdentityHuesTs()],
  [join(SURFACE, "lucide-symbols.ts"), lucideSymbolsTs()],
  [join(UI_NATIVE_TOKENS, "lucide-symbols.ts"), nativeLucideSymbolsTs()],
];

for (const [path, content] of outputs) {
  put(path, content);
  written.push(path);
}

if (!CHECK_ONLY) {
  process.stdout.write(`${written.length} generated files written\n`);
} else if (stale.length > 0) {
  process.stderr.write(
    `${stale.length} generated file(s) no longer match this script:\n${stale.join("\n")}\n` +
      "Run: node packages/brand/scripts/generate-surface-shared.mjs\n",
  );
  process.exit(1);
} else {
  process.stdout.write(`${written.length} generated files are up to date\n`);
}

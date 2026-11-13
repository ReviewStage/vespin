// geist.mjs -- Geist's colors, every step of every scale, the one place a hex of theirs is written.
//
// Vercel's design system (https://vercel.com/geist/colors), copied from the
// stylesheet that page itself loads, in its light theme and its dark. A
// scale's steps keep Geist's own meaning: 100 to 300 a component's ground at
// rest, hovered, and pressed; 400 to 600 its border at rest, hovered, and
// pressed; 700 and 800 a solid fill and its hover; 900 secondary words and
// icons; 1000 primary words. brand-palette.mjs names a step from here for
// each of the product's roles, and generate-surface-shared.mjs writes every
// step as a `--geist-*` custom property (@repo/ui's geist.css) that
// palettes.css names the same way. A role never writes a hex of its own.

/** A step: its color in the light theme and in the dark. */
const step = (light, dark) => ({ LIGHT: light, DARK: dark });

export const GEIST = {
  BACKGROUND: {
    100: step("#ffffff", "#0a0a0a"),
    200: step("#fafafa", "#000000"),
  },
  GRAY: {
    100: step("#f2f2f2", "#1a1a1a"),
    200: step("#ebebeb", "#1f1f1f"),
    300: step("#e6e6e6", "#292929"),
    400: step("#ebebeb", "#2e2e2e"),
    500: step("#c9c9c9", "#454545"),
    600: step("#a8a8a8", "#878787"),
    700: step("#8f8f8f", "#8f8f8f"),
    800: step("#7d7d7d", "#7d7d7d"),
    900: step("#4d4d4d", "#a1a1a1"),
    1000: step("#171717", "#ededed"),
  },
  // The grays as an alpha of black in the light theme and of white in the
  // dark, for an edge or a fill the ground beneath should show through.
  GRAY_ALPHA: {
    100: step("#0000000d", "#ffffff0f"),
    200: step("#00000014", "#ffffff17"),
    300: step("#0000001a", "#ffffff21"),
    400: step("#00000014", "#ffffff24"),
    500: step("#00000036", "#ffffff3d"),
    600: step("#00000057", "#ffffff82"),
    700: step("#00000070", "#ffffff8a"),
    800: step("#00000082", "#ffffff78"),
    900: step("#000000b3", "#ffffff9c"),
    1000: step("#000000e8", "#ffffffeb"),
  },
  BLUE: {
    100: step("#f0f7ff", "#06193a"),
    200: step("#eaf4ff", "#022248"),
    300: step("#e0efff", "#002f62"),
    400: step("#cce7ff", "#003771"),
    500: step("#97ccff", "#004287"),
    600: step("#51aeff", "#0090ff"),
    700: step("#0070f7", "#0071f6"),
    800: step("#005edc", "#005fd8"),
    900: step("#0064e2", "#50a8ff"),
    1000: step("#002453", "#ebf6ff"),
  },
  RED: {
    100: step("#ffeef0", "#330a11"),
    200: step("#ffe9ea", "#440d13"),
    300: step("#ffe4e5", "#5d0e17"),
    400: step("#ffd8d7", "#6f101b"),
    500: step("#ffb5b6", "#88151f"),
    600: step("#ff6a6e", "#f32e40"),
    700: step("#fc0035", "#f13242"),
    800: step("#e70022", "#e2162a"),
    900: step("#d60020", "#ff5e63"),
    1000: step("#46000c", "#ffeaed"),
  },
  AMBER: {
    100: step("#fff6e1", "#291800"),
    200: step("#fff4d4", "#331b00"),
    300: step("#fff1c8", "#4f2900"),
    400: step("#ffdd84", "#573200"),
    500: step("#ffc85e", "#6c4100"),
    600: step("#ffaa00", "#e99c00"),
    700: step("#ffb200", "#ffb200"),
    800: step("#ff9900", "#ff9900"),
    900: step("#a64f00", "#ff9900"),
    1000: step("#541c00", "#fff3d9"),
  },
  GREEN: {
    100: step("#ecfdec", "#00250a"),
    200: step("#e5fce7", "#003110"),
    300: step("#d3fad1", "#003814"),
    400: step("#b9f5bc", "#004616"),
    500: step("#82eb8d", "#00661d"),
    600: step("#4ce15e", "#009431"),
    700: step("#28a948", "#00ab3e"),
    800: step("#279141", "#009335"),
    900: step("#107d32", "#00ca52"),
    1000: step("#00370d", "#daffe5"),
  },
  TEAL: {
    100: step("#dffffb", "#00211b"),
    200: step("#ddfef6", "#002922"),
    300: step("#ccf9f1", "#003b33"),
    400: step("#b1f7ec", "#003f35"),
    500: step("#52f0db", "#005f53"),
    600: step("#00e2c4", "#009885"),
    700: step("#00a694", "#00a794"),
    800: step("#008d7d", "#008d7d"),
    900: step("#007a6e", "#00c9b5"),
    1000: step("#003d34", "#cefff5"),
  },
  PURPLE: {
    100: step("#f9f0ff", "#290c33"),
    200: step("#f9f1ff", "#341142"),
    300: step("#f5e8ff", "#47185e"),
    400: step("#f1d9ff", "#541a76"),
    500: step("#dda9ff", "#642290"),
    600: step("#c77dff", "#9440d5"),
    700: step("#9f00f4", "#9440d5"),
    800: step("#8400cd", "#7d2bba"),
    900: step("#7c00c9", "#c472fb"),
    1000: step("#2e004d", "#faedff"),
  },
  PINK: {
    100: step("#ffeaf5", "#310d1e"),
    200: step("#ffeaf2", "#420c25"),
    300: step("#ffe0eb", "#571032"),
    400: step("#ffd5e1", "#5d0c34"),
    500: step("#fdb3cc", "#76063f"),
    600: step("#f97ea7", "#b90056"),
    700: step("#f22782", "#f12b82"),
    800: step("#e4106e", "#e6006e"),
    900: step("#c41562", "#ff518d"),
    1000: step("#460523", "#ffeaf4"),
  },
};

// Geist's black and white (`--ds-black`, `--ds-contrast-fg`), the same in
// either theme.
export const GEIST_BLACK = "#000000";
export const GEIST_WHITE = "#ffffff";

/** Every scale's steps as one theme's hex: `geistTheme("LIGHT").GRAY[900]`. */
export function geistTheme(theme) {
  return Object.fromEntries(
    Object.entries(GEIST).map(([scale, steps]) => [
      scale,
      Object.fromEntries(Object.entries(steps).map(([at, colors]) => [at, colors[theme]])),
    ]),
  );
}

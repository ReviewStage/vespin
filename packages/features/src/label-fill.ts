// label-fill.ts -- the colors a label filled with its provider's color is drawn in, in the light appearance and the dark, as GitHub draws a pull request's labels.

/**
 * A label is told from another by its color, so where its color is how a
 * reader tells them apart, a pull request's labels, it is filled with it, as
 * GitHub draws one: a solid fill in the light appearance, its words dark or
 * white by how light the fill reads (Rec. 709, at GitHub's own threshold),
 * edged a shade darker so a white label still stands on a white ground; and
 * in the dark a tint of the color, its words in the color itself, lifted
 * toward white where it is too dark to read. The color is six hex digits,
 * the spelling GitHub and Linear answer; any other has no fill. `@repo/ui`'s
 * `Badge` and `@repo/ui-native`'s label chip both draw from it.
 */

/** The one spelling of a provider's color a label is painted in: six hex digits, with or without its `#`. */
export const PROVIDER_COLOR = /^#?([0-9a-f]{6})$/iu;

/** How light a fill reads, past which GitHub writes on it in dark words rather than white. */
const LIGHT_FILL = 0.453;

/** The words written on a light fill, and on a dark one. */
const DARK_WORDS = "#24292f";
const LIGHT_WORDS = "#ffffff";

/** How light a filled label's words must read on the dark ground; a darker color is lifted toward white until they do. */
const DARK_GROUND_WORDS = 0.6;

/** How much darker a light fill's edge is than its fill. */
const EDGE_SHADE = 0.15;

/** The alpha a tint and its edge wear on the dark ground, as two hex digits: an eighth, and a quarter. */
const TINT_ALPHA = "20";
const EDGE_ALPHA = "40";

type Rgb = readonly [number, number, number];

/** A label's fill, edge, and words in one appearance, each a color in hex, the dark's tint and edge with their alpha after. */
export interface LabelInks {
  readonly fill: string;
  readonly edge: string;
  readonly words: string;
}

/** A label's inks in each appearance. */
export interface LabelFill {
  readonly light: LabelInks;
  readonly dark: LabelInks;
}

/** A provider's color as its three channels; none for any spelling but six hex digits. */
function channelsOf(color: string): Rgb | undefined {
  const hex = PROVIDER_COLOR.exec(color.trim())?.[1];

  if (hex === undefined) return undefined;
  const channel = (at: number) => Number.parseInt(hex.slice(at, at + 2), 16);

  return [channel(0), channel(2), channel(4)];
}

/** How light a color reads, from nought to one. */
function lightnessOf([red, green, blue]: Rgb): number {
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
}

/** A color moved toward `toward` (0 or 255) by `by`, from nought to one. */
function mixed([red, green, blue]: Rgb, toward: number, by: number): Rgb {
  const move = (channel: number) => Math.round(channel + (toward - channel) * by);

  return [move(red), move(green), move(blue)];
}

/** A color spelled as six hex digits after a `#`. */
function hexOf(rgb: Rgb): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** The inks a label filled with `color` is drawn in, in each appearance; none for a color it cannot paint. */
export function labelFill(color: string): LabelFill | undefined {
  const rgb = channelsOf(color);

  if (rgb === undefined) return undefined;
  const fill = hexOf(rgb);
  const lightness = lightnessOf(rgb);

  // Note that the lift is how far toward white the words move for their lightness to reach the bound.
  const lift =
    lightness >= DARK_GROUND_WORDS ? 0 : (DARK_GROUND_WORDS - lightness) / (1 - lightness);

  const words = hexOf(mixed(rgb, 255, lift));

  return {
    light: {
      fill,
      edge: hexOf(mixed(rgb, 0, EDGE_SHADE)),
      words: lightness > LIGHT_FILL ? DARK_WORDS : LIGHT_WORDS,
    },
    dark: { fill: `${fill}${TINT_ALPHA}`, edge: `${words}${EDGE_ALPHA}`, words },
  };
}

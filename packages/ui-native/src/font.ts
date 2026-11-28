// font.ts -- the one way a SwiftUI word is set: @expo/ui's `font` modifier, in Geist for words and Geist Mono for code, the faces the desktop and the web draw in.

import { font as systemFont } from "@expo/ui/swift-ui/modifiers";
import { boldTextOn } from "./accessibility.js";

type FontParams = Parameters<typeof systemFont>[0];

type TextStyle = NonNullable<FontParams["textStyle"]>;

type Weight = NonNullable<FontParams["weight"]>;

/**
 * The faces, by the PostScript name of each family's regular face, which the
 * app embeds at every weight a role reads (`apps/mobile/app.config.ts`); a
 * role's weight picks the face of that weight from the family.
 */
const FACE = {
  TEXT: "Geist-Regular",
  CODE: "GeistMono-Regular",
} as const;

/** Each text style's size at the Large Dynamic Type size, which a custom face scales from as the system's own would. */
const STYLE_POINTS: Record<TextStyle, number> = {
  largeTitle: 34,
  title: 28,
  title2: 22,
  title3: 20,
  headline: 17,
  body: 17,
  callout: 16,
  subheadline: 15,
  footnote: 13,
  caption: 12,
  caption2: 11,
};

/** The weight a text style carries on its own, the headline's semibold, which a custom face must be told. */
const STYLE_WEIGHT: Partial<Record<TextStyle, Weight>> = { headline: "semibold" };

/**
 * How a custom face's lines stand, unless the caller names its own: tight,
 * which takes 2 pt off each line, so Geist's natural leading (1.3 times its
 * size, 22.1 pt at 17 pt) stands about as densely as the system face's
 * (20.3 pt), and SwiftUI's rows agree with React Native's
 * (`LINE_HEIGHT_SCALE`) (the developer, Nov 28, 2026).
 */
const LEADING = "tight";

/**
 * Each weight a step heavier, which Bold Text asks of a custom face as it
 * thickens the system's own, so the embedded medium, semibold and bold
 * faces stand in for regular, medium and semibold.
 */
const BOLDER: Record<Weight, Weight> = {
  ultraLight: "light",
  thin: "regular",
  light: "regular",
  regular: "medium",
  medium: "semibold",
  semibold: "bold",
  bold: "bold",
  heavy: "black",
  black: "black",
};

/**
 * Sets a word in the app's face. A text style keeps its Dynamic Type scaling
 * (`Font.custom(_:size:relativeTo:)`), its size and weight given as the
 * system's style would set them; `design: "monospaced"` is code, in Geist
 * Mono. Note that a font sized alone keeps the system's face, since
 * `Font.custom` would scale it with Dynamic Type where the caller already
 * scaled it (a reviewer's badge on its disc), and so does a rounded or serif
 * design, a letter's avatar, since Geist has neither. Bold Text sets each
 * weight a step heavier (`BOLDER`), as it thickens the system's faces.
 */
export function font(params: FontParams): ReturnType<typeof systemFont> {
  const { design, textStyle } = params;

  if (textStyle === undefined || design === "rounded" || design === "serif") {
    return systemFont(params);
  }

  const custom: FontParams = {
    leading: LEADING,
    ...params,
    family: design === "monospaced" ? FACE.CODE : FACE.TEXT,
  };

  const weight = params.weight ?? STYLE_WEIGHT[textStyle] ?? "regular";

  custom.size = params.size ?? STYLE_POINTS[textStyle];

  custom.weight = boldTextOn() ? BOLDER[weight] : weight;

  return systemFont(custom);
}

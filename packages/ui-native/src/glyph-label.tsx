// glyph-label.tsx -- a glyph as SwiftUI draws it, alone or beside an act's words, whether one of Lucide's from the asset catalog or an SF Symbol.

import { Image, Label } from "@expo/ui/swift-ui";
import { font } from "@expo/ui/swift-ui/modifiers";
import type { ReactElement, ReactNode } from "react";
import { type Glyph, glyphImage } from "./glyph.js";

/** The text style a glyph stands at beside an act's words, as SwiftUI sizes a symbol by its text. */
type GlyphTextStyle = "body" | "callout" | "subheadline" | "footnote" | "caption";

/**
 * A glyph on its own, sized by a text style as a symbol beside words is,
 * and drawn in `color` where one is given. Note that the color is drawn into
 * the symbol's own image (`originalColor`, from the app's `@expo/ui` patch),
 * because a system menu draws an icon tinted any other way in its own ink.
 */
export function GlyphImage({
  glyph,
  textStyle = "body",
  color,
}: {
  readonly glyph: Glyph;
  readonly textStyle?: GlyphTextStyle | undefined;
  readonly color?: string | undefined;
}) {
  return (
    <Image
      {...glyphImage(glyph)}
      {...(color === undefined ? {} : { originalColor: color })}
      modifiers={[font({ textStyle })]}
    />
  );
}

/**
 * An act's words beside its glyph, as SwiftUI's own Label. Note that it
 * stands where a button or a menu would take `systemImage`, because that
 * reads an SF Symbol alone, and the app's glyphs are Lucide's custom symbols.
 */
export function GlyphLabel({
  title,
  glyph,
  textStyle,
  color,
}: {
  readonly title: string;
  readonly glyph: Glyph;
  readonly textStyle?: GlyphTextStyle | undefined;
  /** The glyph's own color, which a menu keeps, such as a status's tone. */
  readonly color?: string | undefined;
}) {
  return (
    <Label title={title} icon={<GlyphImage glyph={glyph} textStyle={textStyle} color={color} />} />
  );
}

/**
 * What a SwiftUI button holds: its words alone, or its words beside its glyph,
 * which `@expo/ui`'s `Button` draws from its children where it is given no
 * label of its own.
 */
export function actContent(
  label: string,
  glyph: Glyph | undefined,
  textStyle?: GlyphTextStyle,
  color?: string,
): { readonly label: string } | { readonly children: ReactElement } {
  return glyph === undefined
    ? { label }
    : {
        children: <GlyphLabel title={label} glyph={glyph} textStyle={textStyle} color={color} />,
      };
}

/** What a SwiftUI menu stands as: its words alone, or its words beside its glyph. */
export function menuLabel(label: string, glyph: Glyph | undefined): ReactNode {
  return glyph === undefined ? label : <GlyphLabel title={label} glyph={glyph} />;
}

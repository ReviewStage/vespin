// glyph-label.tsx -- a glyph as SwiftUI draws it, alone or beside an act's words, whether one of Lucide's from the asset catalog or an SF Symbol.

import { Image, Label, Text } from "@expo/ui/swift-ui";
import { font, tag } from "@expo/ui/swift-ui/modifiers";
import type { ReactElement, ReactNode } from "react";
import { type Glyph, glyphImage, type MarkLayer } from "./glyph.js";
import { type ChoiceLook, MENU_ICON, type MenuPhotoFile } from "./row-menu-model.js";
import { MARK_SIZE } from "./tokens/space.js";
import type { StatusTone } from "./tokens/status-tone.js";

/** The text style a glyph stands at beside an act's words, as SwiftUI sizes a symbol by its text. */
type GlyphTextStyle = "body" | "callout" | "subheadline" | "footnote" | "caption";

/**
 * A glyph on its own, sized by a text style as a symbol beside words is. In
 * a view it stands in `color`, its foreground, where one is given; in a
 * system menu, which draws an icon tinted any other way in its own ink, it
 * stands in `menuColor`, drawn into the symbol's own image (`originalColor`,
 * from the app's `@expo/ui` patch). Note that the two never meet, because
 * outside a menu SwiftUI draws that image's custom symbol in its template's
 * own black, past any foreground.
 */
export function GlyphImage({
  glyph,
  textStyle = "body",
  color,
  menuColor,
  under,
}: {
  readonly glyph: Glyph;
  readonly textStyle?: GlyphTextStyle | undefined;
  /** Its ink in a view, such as a problem line's attention ink. */
  readonly color?: string | undefined;
  /** Its ink in a system menu, such as a status's tone. */
  readonly menuColor?: string | undefined;
  /** A glyph drawn faint under it in a system menu, both in `menuColor` and kept in one image (`underAssetName`, from the app's `@expo/ui` patch), as a priority's lit bars stand over every bar it can light. */
  readonly under?: MarkLayer | undefined;
}) {
  return (
    <Image
      {...glyphImage(glyph)}
      {...(menuColor === undefined ? {} : { originalColor: menuColor })}
      {...(under === undefined ? {} : { underAssetName: under.glyph, underOpacity: under.opacity })}
      {...(color === undefined ? {} : { color })}
      modifiers={[font({ textStyle })]}
    />
  );
}

/**
 * A person's photo as a system menu draws it: a file on this device, drawn
 * round at a menu glyph's size and kept as it is (`photoSize`, from the app's
 * `@expo/ui` patch), because a menu templates any other image in its ink.
 */
function MenuPhoto({ photo }: { readonly photo: MenuPhotoFile }) {
  return <Image uiImage={photo} photoSize={MARK_SIZE.MENU_PHOTO} />;
}

/**
 * An act's words beside its glyph, as SwiftUI's own Label. Note that it
 * stands where a button or a menu would take `systemImage`, because that
 * reads an SF Symbol alone, and the app's glyphs are Lucide's custom symbols.
 */
function GlyphLabel({
  title,
  glyph,
  textStyle,
  color,
  under,
}: {
  readonly title: string;
  readonly glyph: Glyph;
  readonly textStyle?: GlyphTextStyle | undefined;
  /** The glyph's own color, which a menu keeps, such as a status's tone. */
  readonly color?: string | undefined;
  /** A glyph drawn faint under it, as `GlyphImage` draws one. */
  readonly under?: MarkLayer | undefined;
}) {
  return (
    <Label
      title={title}
      icon={<GlyphImage glyph={glyph} textStyle={textStyle} menuColor={color} under={under} />}
    />
  );
}

/**
 * A choice's head as a system menu draws it (`choiceLook`): its glyph in
 * its tone's ink, with a faint glyph under it where it has one; its photo,
 * drawn round; its emoji; or its integration's mark, each kept in its own
 * colors, which a menu would otherwise template in its ink.
 */
export function LookIcon({
  look,
  toneInk,
}: {
  readonly look: ChoiceLook;
  readonly toneInk: (tone: StatusTone) => string;
}) {
  switch (look.kind) {
    case MENU_ICON.GLYPH:
      return (
        <GlyphImage
          glyph={look.glyph}
          menuColor={look.tone === undefined ? undefined : toneInk(look.tone)}
          under={look.under}
        />
      );
    case MENU_ICON.PHOTO:
      return <MenuPhoto photo={look.photo} />;
    case MENU_ICON.EMOJI:
      return <Image emoji={look.emoji} emojiSize={MARK_SIZE.MENU_PHOTO} />;
    case MENU_ICON.MARK:
      return <Image assetName={look.asset} />;
  }
}

/**
 * A picker's option as a system menu draws it: its words beside its head
 * (`LookIcon`), or its words alone, tagged with the value picking it
 * chooses, as SwiftUI's `Picker` reads its options.
 */
export function PickOption({
  label,
  value,
  look,
  toneInk,
}: {
  readonly label: string;
  readonly value: string;
  readonly look: ChoiceLook | undefined;
  readonly toneInk: (tone: StatusTone) => string;
}) {
  const tagged = [tag(value)];

  if (look === undefined) return <Text modifiers={tagged}>{label}</Text>;

  return (
    <Label title={label} icon={<LookIcon look={look} toneInk={toneInk} />} modifiers={tagged} />
  );
}

/**
 * What a SwiftUI button holds: its words alone, its words beside a person's
 * photo where it has one, or its words beside its glyph, which `@expo/ui`'s
 * `Button` draws from its children where it is given no label of its own.
 */
export function actContent(
  label: string,
  glyph: Glyph | undefined,
  textStyle?: GlyphTextStyle,
  color?: string,
  photo?: MenuPhotoFile,
  under?: MarkLayer,
): { readonly label: string } | { readonly children: ReactElement } {
  if (photo !== undefined)
    return { children: <Label title={label} icon={<MenuPhoto photo={photo} />} /> };

  return glyph === undefined
    ? { label }
    : {
        children: (
          <GlyphLabel
            title={label}
            glyph={glyph}
            textStyle={textStyle}
            color={color}
            under={under}
          />
        ),
      };
}

/**
 * What a menu's act holds: as `actContent`, or, where it says more under its
 * words, such as when a reminder comes due, its words over that line beside
 * its glyph, or its photo where it has one, which a system menu draws as its
 * title and subtitle.
 */
export function menuActContent(
  label: string,
  glyph: Glyph | undefined,
  detail: string | undefined,
  color?: string,
  photo?: MenuPhotoFile,
): { readonly label: string } | { readonly children: ReactElement } {
  if (detail === undefined) return actContent(label, glyph, undefined, color, photo);

  return {
    children: (
      <>
        <Text>{label}</Text>
        <Text>{detail}</Text>
        {photo !== undefined ? (
          <MenuPhoto photo={photo} />
        ) : glyph === undefined ? null : (
          <GlyphImage glyph={glyph} menuColor={color} />
        )}
      </>
    ),
  };
}

/** What a SwiftUI menu stands as: its words alone, or its words beside its glyph. */
export function menuLabel(label: string, glyph: Glyph | undefined): ReactNode {
  return glyph === undefined ? label : <GlyphLabel title={label} glyph={glyph} />;
}

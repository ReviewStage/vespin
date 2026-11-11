import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { ReactNode } from "react";
import { PlayIcon } from "../../icons/lucide-glyphs.js";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * option-media.tsx -- what one option of a choice shows beside its label: every picture, recording, page, and address it points at, as equal tiles with a caption under each.
 *
 * An agent asking the reader to pick between designs gives each option its
 * own evidence, so the pick and what it is picked by stand in one card
 * (`ChoiceList`'s `below`). Every piece is one tile of one size, whatever it
 * is or whatever shape it was made at: a thumb of a window's shape
 * (`PageThumb` as wide as its tile, a picture or a recording's first frame
 * standing whole on the thumb's ground, a page drawn small, an address's
 * glyph), the tiles as many to a row as stay legible and wrapping under,
 * two to a phone's card. A recording and a page wear a small mark in the
 * thumb's corner saying what they are, since a still of either reads as a
 * picture, a page's handed by its caller as an entity's glyph; a picture
 * wears none, and an address's thumb is its glyph. Under each,
 * its caption on one line, cut short where it runs long, the whole of it
 * in a tooltip and in the tile's name.
 *
 * Each tile is a press opening what it shows: a picture or a recording in
 * the viewer, a page in its tab, an address in the browser. It takes no
 * class or style; its outer spacing is the card's. It is drawn in Tailwind
 * utilities over the theme, with no shadcn/ui base: shadcn has no strip of
 * media.
 */

/** What a piece of an option's media is, which its mark and its name say. */
export const OPTION_MEDIA_KIND = {
  PICTURE: "picture",
  RECORDING: "recording",
  PAGE: "page",
  LINK: "link",
} as const;

export type OptionMediaKind = (typeof OPTION_MEDIA_KIND)[keyof typeof OPTION_MEDIA_KIND];

/** The word each kind's press is named by, before its caption, and what stands as its caption where it has none. */
const KIND_WORD: Record<OptionMediaKind, string> = {
  [OPTION_MEDIA_KIND.PICTURE]: "Picture",
  [OPTION_MEDIA_KIND.RECORDING]: "Recording",
  [OPTION_MEDIA_KIND.PAGE]: "Page",
  [OPTION_MEDIA_KIND.LINK]: "Link",
};

/**
 * The mark each kind wears in its thumb's corner where its caller hands
 * none: a recording's play; a page wears the page's own glyph, which its
 * caller draws as every page is drawn; a picture wears none, and an address
 * none, since its thumb is its glyph already.
 */
const KIND_MARK: Record<OptionMediaKind, ReactNode> = {
  [OPTION_MEDIA_KIND.PICTURE]: null,
  [OPTION_MEDIA_KIND.RECORDING]: <PlayIcon aria-hidden="true" />,
  [OPTION_MEDIA_KIND.PAGE]: null,
  [OPTION_MEDIA_KIND.LINK]: null,
};

/** One piece of an option's media: what it is, its caption, its thumb, and what a press does. */
export interface OptionMediaPiece {
  kind: OptionMediaKind;
  /** Its caption: what it shows, a page's title, or an address's words; none where the agent gave none. */
  caption: string | undefined;
  /** A `PageThumb` of the card's size, contained, filling the tile's width. */
  thumb: ReactNode;
  /** The mark in the thumb's corner saying what it is, a page's glyph; its kind's own where none is given. */
  mark?: ReactNode;
  /** Opens what the tile shows. */
  onOpen: () => void;
}

/** The words under a tile: its caption, or its kind where it has none. */
function captionOf(piece: Pick<OptionMediaPiece, "kind" | "caption">): string {
  return piece.caption === undefined || piece.caption.trim() === ""
    ? KIND_WORD[piece.kind]
    : piece.caption;
}

/** One piece as its tile: the thumb with its mark, and its caption under it, pressed as one. */
function OptionMediaTile({ piece }: { piece: OptionMediaPiece }): React.JSX.Element {
  const caption = captionOf(piece);
  const mark = piece.mark ?? KIND_MARK[piece.kind];
  return (
    <li className="ui-option-media-tile min-w-0">
      <Tooltip label={caption}>
        <ButtonPrimitive
          type="button"
          className="group/option-media m-0 flex w-full min-w-0 flex-col gap-ui-4 rounded-control border-0 bg-transparent p-0 text-start text-inherit [font:inherit]"
          aria-label={`${KIND_WORD[piece.kind]}: ${caption}`}
          onClick={pulseOnPress(() => piece.onOpen(), PRESS_PULSE.QUIET)}
        >
          <span className="relative block transition-opacity duration-(--ui-duration-hover) group-hover/option-media:opacity-90">
            {piece.thumb}
            {mark === null ? null : (
              <span className="ui-option-media-mark absolute right-ui-4 bottom-ui-4 inline-flex rounded-control bg-veil p-ui-4 text-on-veil [&_svg]:size-icon-16">
                {mark}
              </span>
            )}
          </span>
          <Text
            as={TEXT_ELEMENT.SPAN}
            variant={TEXT_VARIANT.CAPTION}
            tone={TEXT_TONE.MUTED}
            truncate
          >
            {caption}
          </Text>
        </ButtonPrimitive>
      </Tooltip>
    </li>
  );
}

/** An option's media: one tile each, of one size, in rows that wrap. */
export function OptionMedia({
  label,
  pieces,
}: {
  /** What the option's media is named: its option's label. */
  label: string;
  pieces: readonly OptionMediaPiece[];
}): React.JSX.Element | null {
  if (pieces.length === 0) return null;
  return (
    <ul
      className="ui-option-media ph-no-capture m-0 grid list-none grid-cols-option-media gap-item-gap p-0"
      aria-label={`${label} media`}
    >
      {/* Note that a tile is keyed by its place, because an option may carry the same page or address twice and its list never reorders. */}
      {pieces.map((piece, index) => (
        <OptionMediaTile key={index} piece={piece} />
      ))}
    </ul>
  );
}

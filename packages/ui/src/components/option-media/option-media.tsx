import type { ReactNode } from "react";
import { LINE_BUTTON_LOOK, LineButton } from "../line-button/line-button.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * option-media.tsx -- what one option of a choice shows beside its label: its pictures as thumbnails, and a line for each page, recording, or address it points at.
 *
 * An agent asking the reader to pick between designs gives each option its
 * own evidence, so the pick and what it is picked by stand in one card
 * (`ChoiceList`'s `below`). The pictures come first, as the caller's
 * `PictureSet` of thumbnails, since a full-width picture would make the
 * card taller than the choice; then one line per other piece, each a
 * `row` line button (`../line-button/line-button.tsx`) holding a small
 * thumb (`PageThumb`'s row size, a page's frame or a recording's first
 * frame) and words saying what it is and its title, "Page · Directions".
 * A press on a line opens it: a page in its tab, a recording in the
 * viewer, an address in the browser. The lines stand in a list named for
 * the option, so a reader hears how many there are and whose they are.
 *
 * It takes no class or style; its outer spacing is the card's. It is drawn
 * in Tailwind utilities over the theme, with no shadcn/ui base: shadcn has
 * no strip of media.
 */

/** What a line of an option's media is, which its words lead with. */
export const OPTION_MEDIA_KIND = {
  PAGE: "page",
  RECORDING: "recording",
  LINK: "link",
} as const;

export type OptionMediaKind = (typeof OPTION_MEDIA_KIND)[keyof typeof OPTION_MEDIA_KIND];

/** The word each kind of line leads with. */
const KIND_WORD: Record<OptionMediaKind, string> = {
  [OPTION_MEDIA_KIND.PAGE]: "Page",
  [OPTION_MEDIA_KIND.RECORDING]: "Recording",
  [OPTION_MEDIA_KIND.LINK]: "Link",
};

/** One line of an option's media: what it is, its title, its small thumb, and what a press does. */
export interface OptionMediaLine {
  /** What the line is keyed by among its option's. */
  id: string;
  kind: OptionMediaKind;
  title: string;
  /** A `PageThumb` of the row's size, or a glyph, standing before its words. */
  thumb: ReactNode;
  /** Opens what the line names. */
  onOpen: () => void;
}

/** The words a line says: its kind, then its title. */
function lineWords(line: Pick<OptionMediaLine, "kind" | "title">): string {
  return `${KIND_WORD[line.kind]} · ${line.title}`;
}

/** An option's media: its pictures, then a line for each other piece. */
export function OptionMedia({
  label,
  pictures,
  lines,
}: {
  /** What the option's media is named: its option's label. */
  label: string;
  /** The option's pictures, as a `PictureSet` of thumbnails; none where it has none. */
  pictures?: ReactNode;
  lines: readonly OptionMediaLine[];
}): React.JSX.Element {
  return (
    <div className="ui-option-media flex min-w-0 flex-col gap-tight-gap">
      {pictures}
      {lines.length === 0 ? null : (
        <ul
          className="ui-option-media-lines m-0 flex list-none flex-col p-0"
          aria-label={`${label} media`}
        >
          {lines.map((line) => (
            <li key={line.id} className="min-w-0">
              <LineButton look={LINE_BUTTON_LOOK.ROW} brightens onClick={() => line.onOpen()}>
                <span className="ui-option-media-thumb flex-none">{line.thumb}</span>
                <Text
                  as={TEXT_ELEMENT.SPAN}
                  variant={TEXT_VARIANT.CAPTION}
                  tone={TEXT_TONE.MUTED}
                  truncate
                >
                  {lineWords(line)}
                </Text>
              </LineButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

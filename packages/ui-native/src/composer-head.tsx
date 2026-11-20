// composer-head.tsx -- what stands over a composer's field inside its glass: the pictures attached to the message as thumbnails and its pasted text files as chips by name and lines, each taken off by its ×, the skills a `/` offers, and the line saying the field holds a sent message's words to send in its place.

import { Button, HStack, Image, ScrollView, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { GLYPH, glyphImage } from "./glyph.js";
import { AvatarPhoto } from "./marks.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** A picture's thumbnail over a composer's field, as Messages draws one: a square cropped from it, its corners rounded as a card's; a pasted text file stands as a tile of the same size. */
const THUMBNAIL = { SIZE: 56, CORNER: 10 } as const;

/** How large the × in a thumbnail's corner stands, the system's mini control, its mark small inside it. */
const DETACH_MARK = 9;

/** How far the × stands in from the thumbnail's corner. */
const DETACH_INSET = SPACE.TIGHT;

/** What a file's × is heard as, by the name it goes under ("Remove Picture 1", "Remove Pasted text 1.txt"). */
function detachWords(name: string): string {
  return `Remove ${name}`;
}

/** One file attached to the message, by the name the message carries it under ("Picture 1", "Pasted text 1.txt"): a picture with the address its thumbnail draws from, such as a `data:` address of its bytes, or a long paste taken as a text file, which has none and says what it holds under its name instead ("12 lines"). */
export type AttachedPicture = {
  readonly id: string;
  readonly name: string;
  readonly address?: string | undefined;
  readonly detail?: string | undefined;
};

/** How wide a file's chip stands at most, its name cut short past it, as the panel's chip cuts a long name. */
const FILE_CHIP_WIDTH = 200;

/** Does nothing, for a thumbnail's load and failure, which the composer has no use for: its own bytes are drawn, and the × stands either way. */
function ignore() {}

/** A pasted text file's chip, as tall as a thumbnail, as the panel's chip draws a file: the document glyph, then its name over what it holds ("12 lines"), on the well, room left at its trailing corner for its ×. */
function TextFileChip({
  name,
  detail,
}: {
  readonly name: string;
  readonly detail?: string | undefined;
}) {
  const colors = useColors();

  return (
    <HStack
      spacing={SPACE.TIGHT * 2}
      modifiers={[
        SwiftModifiers.padding({ leading: SPACE.ROW, trailing: SPACE.ROW + DETACH_MARK * 2 }),
        frame({
          minHeight: THUMBNAIL.SIZE,
          maxHeight: THUMBNAIL.SIZE,
          maxWidth: FILE_CHIP_WIDTH,
          alignment: "leading",
        }),
        SwiftModifiers.background(
          colors.WELL,
          SwiftModifiers.shapes.roundedRectangle({ cornerRadius: THUMBNAIL.CORNER }),
        ),
      ]}
    >
      <Image {...glyphImage(GLYPH.FILE_TEXT)} size={MARK_SIZE.LEAD} color={colors.TEXT_MUTED} />
      <VStack alignment="leading" spacing={0}>
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE }),
            foregroundStyle(colors.TEXT),
            lineLimit(1),
          ]}
        >
          {name}
        </Text>
        {detail === undefined ? null : (
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.TIME }),
              foregroundStyle(colors.TEXT_MUTED),
              lineLimit(1),
            ]}
          >
            {detail}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}

/**
 * The files attached to the message as a row of thumbnails, a pasted text
 * file as a chip as tall, by its name and how many lines it runs to, as the
 * panel's chip says a file, scrolling sideways where they outrun the
 * bar, as Messages and the panel show what a message carries before it
 * goes. Note that only the × in a thumbnail's corner takes the file off, so
 * a press meant to look at a picture never removes it; VoiceOver hears each
 * as its × alone, "Remove Picture 1", since the thumbnail says nothing a
 * reader could act on.
 */
export function AttachedPictures({
  pictures,
  onDetach,
}: {
  readonly pictures: readonly AttachedPicture[];
  readonly onDetach: (id: string) => void;
}) {
  const colors = useColors();

  if (pictures.length === 0) return null;

  return (
    <ScrollView axes="horizontal" showsIndicators={false}>
      <HStack spacing={SPACE.TIGHT * 2}>
        {pictures.map((picture) => (
          <ZStack
            key={picture.id}
            alignment="topTrailing"
            modifiers={
              picture.address === undefined
                ? []
                : [frame({ width: THUMBNAIL.SIZE, height: THUMBNAIL.SIZE })]
            }
          >
            {picture.address === undefined ? (
              <TextFileChip name={picture.name} detail={picture.detail} />
            ) : (
              <AvatarPhoto
                address={picture.address}
                size={THUMBNAIL.SIZE}
                corner={THUMBNAIL.CORNER}
                onFail={ignore}
              />
            )}
            <Button
              onPress={() => onDetach(picture.id)}
              modifiers={[
                buttonStyle("borderedProminent"),
                SwiftModifiers.buttonBorderShape("circle"),
                SwiftModifiers.controlSize("mini"),
                tint(colors.TEXT),
                foregroundStyle(colors.GROUND),
                SwiftModifiers.padding({ top: DETACH_INSET, trailing: DETACH_INSET }),
                accessibilityLabel(detachWords(picture.name)),
              ]}
            >
              <Image {...glyphImage(GLYPH.REMOVE)} size={DETACH_MARK} />
            </Button>
          </ZStack>
        ))}
      </HStack>
    </ScrollView>
  );
}

/** One skill a `/` offers: its word, and what it is for. */
export type SkillSuggestion = {
  readonly name: string;
  readonly word: string;
  readonly detail: string;
};

/** The most suggestions the head stands at once before it scrolls them, so the field stays in sight over the keyboard. */
const SUGGESTIONS_SHOWN = 4;

/** How tall one suggestion stands, in points: a press's least, as Apple's guidelines ask. */
const SUGGESTION_HEIGHT = PRESS_SIZE + 6;

/**
 * The skills a `/` being typed offers, as a list over the field inside the
 * composer's glass, right above the keyboard, as Messages offers its
 * suggestions: each its `/name` and a muted line of what it is for, written
 * into the message on a press; what stands in their place where there are
 * none, such as why they could not be read, said in the muted ink. It
 * scrolls past a few, so the field stays in sight.
 */
export function SkillSuggestions({
  skills,
  empty,
  onPick,
}: {
  readonly skills: readonly SkillSuggestion[];
  /** What stands where no skill is offered: still reading, none matching, or why none were read. */
  readonly empty: string | undefined;
  readonly onPick: (name: string) => void;
}) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const glyph = useScaledSize(MARK_SIZE.GLYPH);
  // Note that at an accessibility size a skill's name and what it is for wrap rather than cut, and the list stands whole, since four rows of a fixed height showed about two.
  const lines = large ? undefined : 1;

  if (skills.length === 0) {
    if (empty === undefined) return null;

    return (
      <Text
        modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
      >
        {empty}
      </Text>
    );
  }

  const rows = (
    <VStack alignment="leading" spacing={0}>
      {skills.map((skill) => (
        <Button
          key={skill.name}
          onPress={() => onPick(skill.name)}
          modifiers={[buttonStyle("plain"), accessibilityLabel(skill.word)]}
        >
          {/* Note that the shape stands on the row's full-width frame, not on the button, so a press past the skill's words still picks it. */}
          <HStack
            spacing={SPACE.ROW}
            modifiers={[
              frame({
                minHeight: SUGGESTION_HEIGHT,
                maxWidth: Number.POSITIVE_INFINITY,
                alignment: "leading",
              }),
              SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
            ]}
          >
            <Image {...glyphImage(GLYPH.SKILL)} size={glyph} color={colors.TEXT_MUTED} />
            <VStack alignment="leading" spacing={1}>
              <Text
                modifiers={[
                  font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: "medium" }),
                  foregroundStyle(colors.TEXT),
                  ...(lines === undefined ? [] : [lineLimit(lines)]),
                ]}
              >
                {skill.word}
              </Text>
              {skill.detail === "" ? null : (
                <Text
                  modifiers={[
                    font({ textStyle: TYPE_ROLE.ROW_LINE }),
                    foregroundStyle(colors.TEXT_MUTED),
                    ...(lines === undefined ? [] : [lineLimit(lines)]),
                  ]}
                >
                  {skill.detail}
                </Text>
              )}
            </VStack>
          </HStack>
        </Button>
      ))}
    </VStack>
  );

  if (large || skills.length <= SUGGESTIONS_SHOWN) return rows;

  return (
    <ScrollView modifiers={[frame({ height: SUGGESTION_HEIGHT * SUGGESTIONS_SHOWN })]}>
      {rows}
    </ScrollView>
  );
}

/** What the line over a field holding a sent message's words says, and its Cancel. */
const EDITING_WORDS = { LINE: "Editing message", CANCEL: "Cancel" } as const;

/**
 * The line over the field while it holds one of the member's sent
 * messages' words, written again to go in that message's place, as the
 * panel's Edit opens the line where it stands: the message's Edit glyph
 * and "Editing message" in the muted ink, and Cancel at its end, which
 * gives the field back what it held.
 */
export function EditingLine({ onCancel }: { readonly onCancel: () => void }) {
  const colors = useColors();
  const glyph = useScaledSize(MARK_SIZE.GLYPH);

  return (
    <HStack spacing={SPACE.TIGHT * 2}>
      <Image {...glyphImage(GLYPH.EDIT_MESSAGE)} size={glyph} color={colors.TEXT_MUTED} />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE }),
          foregroundStyle(colors.TEXT_MUTED),
          frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
        ]}
      >
        {EDITING_WORDS.LINE}
      </Text>
      <Button onPress={onCancel} modifiers={[buttonStyle("plain")]}>
        {/* Note that the press's frame and its shape stand on the label, since a plain button takes a press only where its label is hit. */}
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "medium" }),
            foregroundStyle(colors.TEXT_BODY),
            frame({ minHeight: PRESS_SIZE }),
            SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
          ]}
        >
          {EDITING_WORDS.CANCEL}
        </Text>
      </Button>
    </HStack>
  );
}

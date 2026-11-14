// composer-head.tsx -- what stands over a composer's field inside its glass: the messages queued behind the turn, each with Steer and Delete, the pictures attached to the message as thumbnails, each taken off by its ×, and the skills a `/` offers.

import { Button, HStack, Image, ScrollView, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityHidden,
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { AvatarPhoto } from "./marks.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The panel's words for a queued message's acts. */
const WORDS = {
  STEER: "Steer",
  DELETE: "Delete",
} as const;

/** One message waiting behind the turn, which its starter may steer or delete. */
export type QueuedLine = {
  readonly id: string;
  readonly words: string;
};

type QueuedLinesProps = {
  readonly lines: readonly QueuedLine[];
  /** Why the queue stands paused, said over its lines; nothing while it hands its messages on. */
  readonly paused?: string | undefined;
  /** Sends a queued message now, steering the turn; Steer is not offered where none is given, as for a reader who did not start the agent. */
  readonly onSteer?: ((id: string) => void) | undefined;
  /** Takes a queued message out of the queue; Delete is not offered where none is given. */
  readonly onDelete?: ((id: string) => void) | undefined;
};

/** A queued line's small act at its end: its words in the muted ink, or its glyph alone, pressed anywhere in a frame of a press's size. */
function LineAct({
  label,
  symbol,
  onPress,
}: {
  readonly label: string;
  readonly symbol?: Glyph | undefined;
  readonly onPress: () => void;
}) {
  const colors = useColors();

  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle("plain"),
        frame({ minWidth: PRESS_SIZE, minHeight: PRESS_SIZE }),
        SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
        accessibilityLabel(label),
      ]}
    >
      {symbol === undefined ? (
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "medium" }),
            foregroundStyle(colors.TEXT_BODY),
          ]}
        >
          {label}
        </Text>
      ) : (
        <Image {...glyphImage(symbol)} size={MARK_SIZE.GLYPH} color={colors.TEXT_MUTED} />
      )}
    </Button>
  );
}

/**
 * The messages queued behind the agent's turn, oldest first, as the panel's
 * queue dock lists them over its box: each on one line led by the panel's queued glyph, with
 * Steer, which sends it into the turn now, and Delete; a message on its way
 * reads Sending in their place. Why the queue stands paused heads them.
 */
export function QueuedLines({ lines, paused, onSteer, onDelete }: QueuedLinesProps) {
  const colors = useColors();

  if (lines.length === 0 && paused === undefined) return null;

  return (
    <VStack alignment="leading" spacing={0}>
      {paused === undefined ? null : (
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
        >
          {paused}
        </Text>
      )}
      {lines.map((line) => (
        <HStack key={line.id} spacing={SPACE.ROW} modifiers={[frame({ minHeight: PRESS_SIZE })]}>
          <Image
            {...glyphImage(GLYPH.QUEUED)}
            size={MARK_SIZE.GLYPH}
            color={colors.TEXT_MUTED}
            modifiers={[accessibilityHidden()]}
          />
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_TITLE }),
              foregroundStyle(colors.TEXT_BODY),
              lineLimit(1),
              frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
            ]}
          >
            {line.words}
          </Text>
          {onSteer === undefined ? null : (
            <LineAct label={WORDS.STEER} onPress={() => onSteer(line.id)} />
          )}
          {onDelete === undefined ? null : (
            <LineAct label={WORDS.DELETE} symbol={GLYPH.DELETE} onPress={() => onDelete(line.id)} />
          )}
        </HStack>
      ))}
    </VStack>
  );
}

/** A picture's thumbnail over a composer's field, as Messages draws one: a square cropped from it, its corners rounded as a card's. */
const THUMBNAIL = { SIZE: 56, CORNER: 10 } as const;

/** How large the × in a thumbnail's corner stands, the system's mini control, its mark small inside it. */
const DETACH_MARK = 9;

/** How far the × stands in from the thumbnail's corner. */
const DETACH_INSET = SPACE.TIGHT;

/** What a picture's × is heard as, by the name it goes under ("Remove Picture 1"). */
function detachWords(name: string): string {
  return `Remove ${name}`;
}

/** One picture attached to the message: the name it goes under ("Picture 1"), and the address its thumbnail draws from, such as a `data:` address of its bytes. */
export type AttachedPicture = {
  readonly id: string;
  readonly name: string;
  readonly address: string;
};

/** Does nothing, for a thumbnail's load and failure, which the composer has no use for: its own bytes are drawn, and the × stands either way. */
function ignore() {}

/**
 * The pictures attached to the message as a row of thumbnails, scrolling
 * sideways where they outrun the bar, as Messages and the panel show what a
 * message carries before it goes. Note that only the × in a thumbnail's
 * corner takes the picture off, so a press meant to look at a picture never
 * removes it; VoiceOver hears each as its × alone, "Remove Picture 1", since
 * the thumbnail says nothing a reader could act on.
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
            modifiers={[frame({ width: THUMBNAIL.SIZE, height: THUMBNAIL.SIZE })]}
          >
            <AvatarPhoto
              address={picture.address}
              size={THUMBNAIL.SIZE}
              corner={THUMBNAIL.CORNER}
              onLoad={ignore}
              onFail={ignore}
            />
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
          modifiers={[
            buttonStyle("plain"),
            SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
            accessibilityLabel(skill.word),
          ]}
        >
          <HStack
            spacing={SPACE.ROW}
            modifiers={[
              frame({
                minHeight: SUGGESTION_HEIGHT,
                maxWidth: Number.POSITIVE_INFINITY,
                alignment: "leading",
              }),
            ]}
          >
            <Image {...glyphImage(GLYPH.SKILL)} size={MARK_SIZE.GLYPH} color={colors.TEXT_MUTED} />
            <VStack alignment="leading" spacing={1}>
              <Text
                modifiers={[
                  font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: "medium" }),
                  foregroundStyle(colors.TEXT),
                  lineLimit(1),
                ]}
              >
                {skill.word}
              </Text>
              {skill.detail === "" ? null : (
                <Text
                  modifiers={[
                    font({ textStyle: TYPE_ROLE.ROW_LINE }),
                    foregroundStyle(colors.TEXT_MUTED),
                    lineLimit(1),
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

  if (skills.length <= SUGGESTIONS_SHOWN) return rows;

  return (
    <ScrollView modifiers={[frame({ height: SUGGESTION_HEIGHT * SUGGESTIONS_SHOWN })]}>
      {rows}
    </ScrollView>
  );
}

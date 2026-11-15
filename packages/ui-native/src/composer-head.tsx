// composer-head.tsx -- what stands over a composer's field inside its glass: the messages queued behind the turn, each with Steer and Delete, the pictures attached to the message, each taken off on a press, and the skills a `/` offers.

import { Button, HStack, Image, ScrollView, Text, VStack } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityHidden,
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
} from "@expo/ui/swift-ui/modifiers";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { Chip } from "./button.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
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
  const glyph = useScaledSize(MARK_SIZE.GLYPH);

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
        <Image {...glyphImage(symbol)} size={glyph} color={colors.TEXT_MUTED} />
      )}
    </Button>
  );
}

/** How many lines a queued message keeps at an accessibility size before it is cut. */
const QUEUED_LINES_LARGE = 3;

/** A queued message's Steer and Delete, where each is offered. */
function QueuedActs({
  id,
  onSteer,
  onDelete,
}: {
  readonly id: string;
  readonly onSteer: QueuedLinesProps["onSteer"];
  readonly onDelete: QueuedLinesProps["onDelete"];
}) {
  return (
    <>
      {onSteer === undefined ? null : <LineAct label={WORDS.STEER} onPress={() => onSteer(id)} />}
      {onDelete === undefined ? null : (
        <LineAct label={WORDS.DELETE} symbol={GLYPH.DELETE} onPress={() => onDelete(id)} />
      )}
    </>
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
  const large = useAccessibilitySize();
  const glyph = useScaledSize(MARK_SIZE.GLYPH);

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
      {lines.map((line) => {
        const words = (
          <HStack spacing={SPACE.ROW} modifiers={[frame({ minHeight: PRESS_SIZE })]}>
            <Image
              {...glyphImage(GLYPH.QUEUED)}
              size={glyph}
              color={colors.TEXT_MUTED}
              modifiers={[accessibilityHidden()]}
            />
            <Text
              modifiers={[
                font({ textStyle: TYPE_ROLE.ROW_TITLE }),
                foregroundStyle(colors.TEXT_BODY),
                lineLimit(large ? QUEUED_LINES_LARGE : 1),
                frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
              ]}
            >
              {line.words}
            </Text>
            {large ? null : <QueuedActs id={line.id} onSteer={onSteer} onDelete={onDelete} />}
          </HStack>
        );

        // Note that at an accessibility size a queued message keeps a few lines and its acts stand under it, since on one line beside Steer and Delete it read as a few letters on the folded Duo's 466 pt.
        return large ? (
          <VStack key={line.id} alignment="trailing" spacing={0}>
            {words}
            <HStack spacing={SPACE.ROW}>
              <QueuedActs id={line.id} onSteer={onSteer} onDelete={onDelete} />
            </HStack>
          </VStack>
        ) : (
          <VStack key={line.id} spacing={0}>
            {words}
          </VStack>
        );
      })}
    </VStack>
  );
}

/** What a press on an attached picture is heard to do, since its × alone says so on screen. */
const DETACH_HINT = "Removes it from the message";

/** One picture attached to the message, by the name the message carries it under ("Picture 1"). */
export type AttachedPicture = { readonly id: string; readonly name: string };

/** The pictures attached to the message as a row of capsules, each taken off the message on a press, scrolling sideways where they outrun the bar. */
export function AttachedPictures({
  pictures,
  onDetach,
}: {
  readonly pictures: readonly AttachedPicture[];
  readonly onDetach: (id: string) => void;
}) {
  if (pictures.length === 0) return null;

  return (
    <ScrollView axes="horizontal" showsIndicators={false}>
      <HStack spacing={SPACE.TIGHT * 2}>
        {pictures.map((picture) => (
          <Chip
            key={picture.id}
            label={picture.name}
            symbol={GLYPH.REMOVE}
            hint={DETACH_HINT}
            onPress={() => onDetach(picture.id)}
          />
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

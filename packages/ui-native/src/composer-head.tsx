// composer-head.tsx -- what stands over a composer's field inside its glass: the messages queued behind the turn, each with Steer and Delete, the pictures attached to the message, each taken off on a press, and the skills a `/` offers.

import { Button, Circle, HStack, Image, ScrollView, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityHidden,
  accessibilityHint,
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
} from "@expo/ui/swift-ui/modifiers";
import { useState } from "react";
import { Chip } from "./button.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { AvatarPhoto } from "./marks.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, RADIUS, SPACE } from "./tokens/space.js";
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

/** What an attached picture's × is heard as, naming the picture it takes off, as Messages' attachment ✕ is. */
function detachName(name: string): string {
  return `Remove ${name}`;
}

/** What a press on an attached picture is heard to do, since its × alone says so on screen. */
const DETACH_HINT = "Removes it from the message";

/** One picture attached to the message, by the name the message carries it under ("Picture 1"), and the address its thumbnail draws from, such as its JPEG's `data:` address; a capsule of its name where none is given. */
export type AttachedPicture = {
  readonly id: string;
  readonly name: string;
  readonly preview?: string | undefined;
};

/** An attached picture's thumbnail, in points, as Messages draws one over its field. */
const THUMB_SIZE = 56;

/** The × disc at a thumbnail's corner, in points. */
const DETACH_DISC = 20;

/** Nothing, for a thumbnail that needs no word once its picture has drawn. */
const DRAWN = () => undefined;

/**
 * An attached picture as Messages draws one over its field: the picture
 * itself on a rounded tile, a × disc at its corner that takes it off the
 * message, in a press of Apple's least size over the tile's corner. Note
 * that the × stands over the picture rather than the picture inside a
 * button, since the picture is a React Native view SwiftUI hosts, which
 * takes its own touches; a picture that cannot draw stands as its name's
 * capsule instead.
 */
function AttachedThumb({
  picture,
  preview,
  onDetach,
}: {
  readonly picture: AttachedPicture;
  readonly preview: string;
  readonly onDetach: () => void;
}) {
  const colors = useColors();
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <Chip label={picture.name} symbol={GLYPH.REMOVE} hint={DETACH_HINT} onPress={onDetach} />
    );
  }

  return (
    <ZStack alignment="topTrailing" modifiers={[frame({ width: THUMB_SIZE, height: THUMB_SIZE })]}>
      <AvatarPhoto
        address={preview}
        size={THUMB_SIZE}
        corner={RADIUS.TILE}
        onLoad={DRAWN}
        onFail={() => setFailed(true)}
      />
      <Button
        onPress={onDetach}
        modifiers={[
          buttonStyle("plain"),
          accessibilityLabel(detachName(picture.name)),
          accessibilityHint(DETACH_HINT),
        ]}
      >
        <ZStack
          alignment="topTrailing"
          modifiers={[
            frame({ width: PRESS_SIZE, height: PRESS_SIZE, alignment: "topTrailing" }),
            SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
          ]}
        >
          <ZStack
            modifiers={[
              frame({ width: DETACH_DISC, height: DETACH_DISC }),
              SwiftModifiers.padding({ all: SPACE.TIGHT }),
            ]}
          >
            <Circle modifiers={[foregroundStyle(colors.TEXT)]} />
            <Image
              {...glyphImage(GLYPH.REMOVE)}
              size={MARK_SIZE.GLYPH - 4}
              color={colors.GROUND}
              modifiers={[accessibilityHidden()]}
            />
          </ZStack>
        </ZStack>
      </Button>
    </ZStack>
  );
}

/** The pictures attached to the message as a row of thumbnails, each taken off the message by its ×, scrolling sideways where they outrun the bar. */
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
        {pictures.map((picture) =>
          picture.preview === undefined ? (
            <Chip
              key={picture.id}
              label={picture.name}
              symbol={GLYPH.REMOVE}
              hint={DETACH_HINT}
              onPress={() => onDetach(picture.id)}
            />
          ) : (
            <AttachedThumb
              key={picture.id}
              picture={picture}
              preview={picture.preview}
              onDetach={() => onDetach(picture.id)}
            />
          ),
        )}
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

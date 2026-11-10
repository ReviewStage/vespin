// composer-head.tsx -- what stands over a composer's field inside its glass: the messages queued behind the turn, each with Steer and Delete, and the pictures attached to the message, each taken off on a press.

import { Button, HStack, Image, ScrollView, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
} from "@expo/ui/swift-ui/modifiers";
import { Chip } from "./button.js";
import type { SfSymbol } from "./sf-symbol.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The panel's words for a queued message's acts and its sending. */
const WORDS = {
  STEER: "Steer",
  DELETE: "Delete",
  SENDING: "Sending",
} as const;

/** One message waiting behind the turn: queued, which its starter may steer or delete, or on its way. */
export type QueuedLine = {
  readonly id: string;
  readonly words: string;
  /** Whether it is on its way rather than waiting in the queue, so it offers nothing. */
  readonly sending: boolean;
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

/** A queued line's small act at its end: its words in the muted ink, or its glyph alone. */
function LineAct({
  label,
  symbol,
  onPress,
}: {
  readonly label: string;
  readonly symbol?: SfSymbol | undefined;
  readonly onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Button onPress={onPress} modifiers={[buttonStyle("plain"), accessibilityLabel(label)]}>
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
        <Image systemName={symbol} size={MARK_SIZE.GLYPH} color={colors.TEXT_MUTED} />
      )}
    </Button>
  );
}

/**
 * The messages queued behind the agent's turn, oldest first, as the panel's
 * queue dock lists them over its box: each on one line led by a clock, with
 * Steer, which sends it into the turn now, and Delete; a message on its way
 * reads Sending in their place. Why the queue stands paused heads them.
 */
export function QueuedLines({ lines, paused, onSteer, onDelete }: QueuedLinesProps) {
  const colors = useColors();
  if (lines.length === 0 && paused === undefined) return null;
  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT * 2}>
      {paused === undefined ? null : (
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
        >
          {paused}
        </Text>
      )}
      {lines.map((line) => (
        <HStack key={line.id} spacing={SPACE.ROW}>
          <Image
            systemName={line.sending ? "arrow.up.circle" : "clock"}
            size={MARK_SIZE.GLYPH}
            color={colors.TEXT_MUTED}
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
          {line.sending ? (
            <Text
              modifiers={[font({ textStyle: TYPE_ROLE.TIME }), foregroundStyle(colors.TEXT_MUTED)]}
            >
              {WORDS.SENDING}
            </Text>
          ) : (
            <>
              {onSteer === undefined ? null : (
                <LineAct label={WORDS.STEER} onPress={() => onSteer(line.id)} />
              )}
              {onDelete === undefined ? null : (
                <LineAct label={WORDS.DELETE} symbol="trash" onPress={() => onDelete(line.id)} />
              )}
            </>
          )}
        </HStack>
      ))}
    </VStack>
  );
}

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
            symbol="xmark"
            onPress={() => onDetach(picture.id)}
          />
        ))}
      </HStack>
    </ScrollView>
  );
}

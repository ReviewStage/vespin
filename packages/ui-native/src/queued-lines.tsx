// queued-lines.tsx -- the messages queued behind an agent's turn, standing in a glass of their own over its composer, as the panel stands its queue over the box: each with Steer and Delete, a long press offering them with Edit, Move Up and Move Down, one being edited muted with Cancel, Resume while the queue stands paused, and two or more folded under one line that opens them.

import { Button, HStack, Image, ScrollView, Text, VStack } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityHidden,
  accessibilityHint,
  accessibilityLabel,
  accessibilityValue,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import { useState } from "react";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { BAR_GLASS } from "./glass-bar.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { type HeldAct, HeldSwiftMenu } from "./held-menu.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The panel's words for a queued message's acts, and the long press's two for its place. */
const WORDS = {
  STEER: "Steer",
  EDIT: "Edit",
  DELETE: "Delete",
  CANCEL: "Cancel",
  RESUME: "Resume",
  MOVE_UP: "Move Up",
  MOVE_DOWN: "Move Down",
} as const;

/** What the line a folded queue stands as says: how many wait, as the panel's dock counts them, and what a press on it does, as VoiceOver hears it. */
const FOLD_WORDS = {
  count: (count: number) => `${count} queued`,
  HINT: "Shows or hides the queued messages",
  OPEN: "Expanded",
  FOLDED: "Collapsed",
} as const;

/** How many queued messages fold under one line, so the queue and the composer's head leave the transcript most of the screen while the keyboard stands. */
const FOLD_AT = 2;

/** How many lines a queued message keeps at an accessibility size before it is cut. */
const QUEUED_LINES_LARGE = 3;

/** How many queued messages stand in sight before the rest scroll, as the panel's dock stands about three. */
const LINES_IN_SIGHT = 3;

/** How tall a queued message stands at an accessibility size, its few lines over its acts, in rows of a press's height, which the scroll a long queue stands in counts by. */
const LARGE_ROW_PRESSES = 2.5;

/** One message waiting behind the turn, which its starter may steer, move, or delete. */
export type QueuedLine = {
  readonly id: string;
  readonly words: string;
  /** Whether its words stand in a field being edited, this one's or another window's, which stops the queue at it. */
  readonly editing?: boolean | undefined;
  /** Whether its words may be taken into the field to edit, as a message of words alone may. */
  readonly editable?: boolean | undefined;
};

type QueuedLinesProps = {
  readonly lines: readonly QueuedLine[];
  /** Why the queue stands paused, said over its lines; nothing while it hands its messages on. */
  readonly paused?: string | undefined;
  /** Sends a queued message now, steering the turn; Steer is not offered where none is given, as for a reader who did not start the agent. */
  readonly onSteer?: ((id: string) => void) | undefined;
  /** Asks to take a queued message out of the queue; Delete is not offered where none is given. */
  readonly onDelete?: ((id: string) => void) | undefined;
  /** Puts the message at `from` at `to`, as the panel's drag drops it; no Move Up or Move Down where none is given. */
  readonly onMove?: ((from: number, to: number) => void) | undefined;
  /** Lets a paused queue hand its messages on again; Resume is not offered where none is given. */
  readonly onResume?: (() => void) | undefined;
  /** Takes a queued message's words into the field to edit; Edit is not offered where none is given, or on a message with files. */
  readonly onEdit?: ((id: string) => void) | undefined;
  /** Gives up an edit standing on a message, this field's or another window's; Cancel is not offered where none is given. */
  readonly onCancelEdit?: ((id: string) => void) | undefined;
};

/** A queued line's small act at its end: its words in the body's ink, or its glyph alone, pressed anywhere in a frame of a press's size. */
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
    <Button onPress={onPress} modifiers={[buttonStyle("plain"), accessibilityLabel(label)]}>
      {/* Note that the press's frame and its shape stand on the label, not on the button, since a plain button takes a press only where its label is hit. */}
      <HStack
        modifiers={[
          frame({ minWidth: PRESS_SIZE, minHeight: PRESS_SIZE }),
          SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
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
      </HStack>
    </Button>
  );
}

/** A queued message's Steer and Delete, where each is offered, or Cancel while it is being edited. */
function QueuedActs({
  line,
  onSteer,
  onDelete,
  onCancelEdit,
}: {
  readonly line: QueuedLine;
  readonly onSteer: QueuedLinesProps["onSteer"];
  readonly onDelete: QueuedLinesProps["onDelete"];
  readonly onCancelEdit: QueuedLinesProps["onCancelEdit"];
}) {
  const { id } = line;

  if (line.editing === true) {
    return onCancelEdit === undefined ? null : (
      <LineAct label={WORDS.CANCEL} onPress={() => onCancelEdit(id)} />
    );
  }

  return (
    <>
      {onSteer === undefined ? null : <LineAct label={WORDS.STEER} onPress={() => onSteer(id)} />}
      {onDelete === undefined ? null : (
        <LineAct label={WORDS.DELETE} symbol={GLYPH.DELETE} onPress={() => onDelete(id)} />
      )}
    </>
  );
}

/** A queued line's long press: Steer, Move Up where a line stands above it, Move Down where one stands below, and Delete, each where it is offered. */
function heldActs(
  line: QueuedLine,
  place: number,
  count: number,
  {
    onSteer,
    onDelete,
    onMove,
    onEdit,
    onCancelEdit,
  }: Pick<QueuedLinesProps, "onSteer" | "onDelete" | "onMove" | "onEdit" | "onCancelEdit">,
): HeldAct[] {
  const { id } = line;

  // Note that a message being edited offers only its Cancel, as the panel's edited row does, since the queue stops at it.
  if (line.editing === true) {
    return onCancelEdit === undefined
      ? []
      : [{ label: WORDS.CANCEL, symbol: GLYPH.REMOVE, onPress: () => onCancelEdit(id) }];
  }

  const up: HeldAct[] =
    onMove === undefined || place === 0
      ? []
      : [{ label: WORDS.MOVE_UP, symbol: GLYPH.MOVE_UP, onPress: () => onMove(place, place - 1) }];

  const down: HeldAct[] =
    onMove === undefined || place === count - 1
      ? []
      : [
          {
            label: WORDS.MOVE_DOWN,
            symbol: GLYPH.MOVE_DOWN,
            onPress: () => onMove(place, place + 1),
          },
        ];

  return [
    ...(onSteer === undefined
      ? []
      : [{ label: WORDS.STEER, symbol: GLYPH.STEER, onPress: () => onSteer(id) }]),
    ...(onEdit === undefined || line.editable !== true
      ? []
      : [{ label: WORDS.EDIT, symbol: GLYPH.RENAME, onPress: () => onEdit(id) }]),
    ...up,
    ...down,
    ...(onDelete === undefined
      ? []
      : [
          {
            label: WORDS.DELETE,
            symbol: GLYPH.DELETE,
            destructive: true,
            onPress: () => onDelete(id),
          },
        ]),
  ];
}

/** One queued message's row: the queue's glyph, its words on one line, or a few past the accessibility sizes with its acts under them, and Steer and Delete. */
function QueuedRow({
  line,
  acts,
  onSteer,
  onDelete,
  onCancelEdit,
}: {
  readonly line: QueuedLine;
  readonly acts: readonly HeldAct[];
  readonly onCancelEdit: QueuedLinesProps["onCancelEdit"];
  readonly onSteer: QueuedLinesProps["onSteer"];
  readonly onDelete: QueuedLinesProps["onDelete"];
}) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const glyph = useScaledSize(MARK_SIZE.GLYPH);

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
          // Note that a message being edited stands muted in its place, as the panel's edited row does, the queue stopping at it.
          foregroundStyle(line.editing === true ? colors.TEXT_MUTED : colors.TEXT_BODY),
          lineLimit(large ? QUEUED_LINES_LARGE : 1),
          frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
        ]}
      >
        {line.words}
      </Text>
      {large ? null : (
        <QueuedActs line={line} onSteer={onSteer} onDelete={onDelete} onCancelEdit={onCancelEdit} />
      )}
    </HStack>
  );

  // Note that at an accessibility size a queued message keeps a few lines and its acts stand under it, since on one line beside Steer and Delete it read as a few letters on the folded Duo's 466 pt.
  return (
    <HeldSwiftMenu acts={[...acts]}>
      {large ? (
        <VStack alignment="trailing" spacing={0}>
          {words}
          <HStack spacing={SPACE.ROW}>
            <QueuedActs
              line={line}
              onSteer={onSteer}
              onDelete={onDelete}
              onCancelEdit={onCancelEdit}
            />
          </HStack>
        </VStack>
      ) : (
        <VStack spacing={0}>{words}</VStack>
      )}
    </HeldSwiftMenu>
  );
}

/**
 * The line a folded queue stands as, which opens and folds it: the queued
 * glyph, how many wait, and the chevron saying whether it stands open, then
 * why the queue stands paused, where it does, with Resume, so a paused queue
 * says so folded too.
 */
function FoldLine({
  count,
  open,
  paused,
  onToggle,
  onResume,
}: {
  readonly count: number;
  readonly open: boolean;
  readonly paused: string | undefined;
  readonly onToggle: () => void;
  readonly onResume: (() => void) | undefined;
}) {
  const colors = useColors();
  const glyph = useScaledSize(MARK_SIZE.GLYPH);
  const words = FOLD_WORDS.count(count);

  return (
    <HStack
      spacing={SPACE.ROW}
      modifiers={[padding({ leading: SPACE.ROW, trailing: SPACE.TIGHT })]}
    >
      <Button
        onPress={onToggle}
        modifiers={[
          buttonStyle("plain"),
          accessibilityLabel(words),
          accessibilityValue(open ? FOLD_WORDS.OPEN : FOLD_WORDS.FOLDED),
          accessibilityHint(FOLD_WORDS.HINT),
        ]}
      >
        {/* Note that the press's frame and its shape stand on the label, not on the button, since a plain button takes a press only where its label is hit. */}
        <HStack
          spacing={SPACE.ROW}
          modifiers={[
            frame({
              minHeight: PRESS_SIZE,
              maxWidth: Number.POSITIVE_INFINITY,
              alignment: "leading",
            }),
            SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
          ]}
        >
          <Image {...glyphImage(GLYPH.QUEUED)} size={glyph} color={colors.TEXT_MUTED} />
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_TITLE }),
              foregroundStyle(colors.TEXT_BODY),
            ]}
          >
            {words}
          </Text>
          {paused === undefined ? null : (
            <Text
              modifiers={[
                font({ textStyle: TYPE_ROLE.ROW_LINE }),
                foregroundStyle(colors.TEXT_MUTED),
                lineLimit(1),
              ]}
            >
              {paused}
            </Text>
          )}
          <Image
            {...glyphImage(open ? GLYPH.UNFOLDED : GLYPH.FOLDED)}
            size={glyph}
            color={colors.TEXT_MUTED}
          />
        </HStack>
      </Button>
      {onResume === undefined || paused === undefined ? null : (
        <LineAct label={WORDS.RESUME} symbol={GLYPH.PLAY} onPress={onResume} />
      )}
    </HStack>
  );
}

/**
 * The messages queued behind the agent's turn, oldest first, standing over
 * its composer in a glass of their own, as the panel's queue dock stands
 * over its box: each on one line led by the panel's queued glyph, with
 * Steer, which sends it into the turn now, and Delete. A long press on a
 * line offers the same with Edit, Move Up and Move Down, each only where a
 * line stands to pass, and one being edited stands muted with Cancel. Why
 * the queue stands paused heads them, with Resume. Two or more fold under
 * one line saying how many wait, the paused words and Resume on it, which a
 * press opens and folds again, so the queue and the composer's head leave
 * the transcript most of the screen while the keyboard stands; one being
 * edited holds it open, so its Cancel stays in reach. Note
 * that the lines stand at the height their words take, and past three they
 * scroll, so a long queue never pushes the composer off the screen; no line
 * is dragged, since SwiftUI drags a row only in its list, which cannot size
 * itself to its rows and cut them.
 */
export function QueuedLines({
  lines,
  paused,
  onSteer,
  onDelete,
  onMove,
  onResume,
  onEdit,
  onCancelEdit,
}: QueuedLinesProps) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const press = useScaledSize(PRESS_SIZE);
  const [opened, setOpened] = useState(false);

  if (lines.length === 0 && paused === undefined) return null;
  const folds = lines.length >= FOLD_AT;
  const open = !folds || opened || lines.some((line) => line.editing === true);

  const row = large ? press * LARGE_ROW_PRESSES : press;
  const rowLook = [padding({ leading: SPACE.ROW, trailing: SPACE.TIGHT })];

  const stack = (
    <VStack spacing={0}>
      {lines.map((line, index) => (
        <VStack key={line.id} modifiers={rowLook}>
          <QueuedRow
            line={line}
            acts={heldActs(line, index, lines.length, {
              onSteer,
              onDelete,
              onMove,
              onEdit,
              onCancelEdit,
            })}
            onSteer={onSteer}
            onDelete={onDelete}
            onCancelEdit={onCancelEdit}
          />
        </VStack>
      ))}
    </VStack>
  );

  // Note that a queue past three lines scrolls, as tall as three rows of its size stand.
  return (
    <VStack spacing={0} modifiers={[padding({ vertical: SPACE.TIGHT }), ...BAR_GLASS]}>
      {folds ? (
        <FoldLine
          count={lines.length}
          open={open}
          paused={paused}
          onToggle={() => setOpened((was) => !was)}
          onResume={onResume}
        />
      ) : null}
      {folds || paused === undefined ? null : (
        <HStack
          spacing={SPACE.ROW}
          modifiers={[padding({ leading: SPACE.ROW, trailing: SPACE.TIGHT })]}
        >
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_LINE }),
              foregroundStyle(colors.TEXT_MUTED),
              frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
            ]}
          >
            {paused}
          </Text>
          {onResume === undefined ? null : (
            <LineAct label={WORDS.RESUME} symbol={GLYPH.PLAY} onPress={onResume} />
          )}
        </HStack>
      )}
      {open ? (
        lines.length > LINES_IN_SIGHT ? (
          <ScrollView modifiers={[frame({ height: row * LINES_IN_SIGHT })]}>{stack}</ScrollView>
        ) : (
          stack
        )
      ) : null}
    </VStack>
  );
}

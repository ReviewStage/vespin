// queued-lines.tsx -- the messages queued behind an agent's turn, standing in a glass of their own over its composer, as the panel stands its queue over the box: each with Steer and Delete, a long press offering them with Move Up and Move Down, a drag putting one in another place, and Resume while the queue stands paused.

import { Button, HStack, Image, List, Text, VStack } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityHidden,
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listStyle,
  onGeometryChange,
  padding,
  scrollContentBackground,
} from "@expo/ui/swift-ui/modifiers";
import { useState } from "react";
import { useWindowDimensions } from "react-native";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { useBarGlass } from "./glass-bar.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { type HeldAct, HeldSwiftMenu } from "./held-menu.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The panel's words for a queued message's acts, and the long press's two for its drag. */
const WORDS = {
  STEER: "Steer",
  DELETE: "Delete",
  RESUME: "Resume",
  MOVE_UP: "Move Up",
  MOVE_DOWN: "Move Down",
} as const;

/** How many lines a queued message keeps at an accessibility size before it is cut. */
const QUEUED_LINES_LARGE = 3;

/** How many queued messages stand in sight before the rest scroll, as the panel's dock stands about three. */
const LINES_IN_SIGHT = 3;

/** How tall a queued message stands at an accessibility size before it is measured, its few lines over its acts, in rows of a press's height. */
const LARGE_ROW_PRESSES = 2.5;

/** The most of the window's height the queue takes, so the composer and the keyboard always keep the rest. */
const MOST_OF_WINDOW = 0.25;

/** One message waiting behind the turn, which its starter may steer, move, or delete. */
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
  /** Asks to take a queued message out of the queue; Delete is not offered where none is given. */
  readonly onDelete?: ((id: string) => void) | undefined;
  /** Puts the message at `from` at `to`, as the panel's drag drops it; no drag, Move Up, or Move Down where none is given. */
  readonly onMove?: ((from: number, to: number) => void) | undefined;
  /** Lets a paused queue hand its messages on again; Resume is not offered where none is given. */
  readonly onResume?: (() => void) | undefined;
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

/** A queued line's long press: Steer, Move Up where a line stands above it, Move Down where one stands below, and Delete, each where it is offered. */
function heldActs(
  id: string,
  place: number,
  count: number,
  { onSteer, onDelete, onMove }: Pick<QueuedLinesProps, "onSteer" | "onDelete" | "onMove">,
): HeldAct[] {
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

/**
 * How tall the list of messages stands: the first few rows whole, as tall as
 * each was measured, and no more of them than the window's share holds, but
 * always the first, so a row is never cut through its words; the rest scroll.
 */
function sightHeight(rows: readonly number[], most: number): number {
  let height = 0;

  for (const row of rows.slice(0, LINES_IN_SIGHT)) {
    if (height > 0 && height + row > most) break;
    height += row;
  }

  return height;
}

/** Where a message dragged from `from` lands, as the panel's move takes it, from SwiftUI's destination, which counts the places before the message is taken out. */
function landing(from: number, destination: number): number {
  return destination > from ? destination - 1 : destination;
}

/** One queued message's row: the queue's glyph, its words on one line, or a few past the accessibility sizes with its acts under them, and Steer and Delete. */
function QueuedRow({
  line,
  acts,
  onSteer,
  onDelete,
}: {
  readonly line: QueuedLine;
  readonly acts: readonly HeldAct[];
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
  return (
    <HeldSwiftMenu acts={[...acts]}>
      {large ? (
        <VStack alignment="trailing" spacing={0}>
          {words}
          <HStack spacing={SPACE.ROW}>
            <QueuedActs id={line.id} onSteer={onSteer} onDelete={onDelete} />
          </HStack>
        </VStack>
      ) : (
        <VStack spacing={0}>{words}</VStack>
      )}
    </HeldSwiftMenu>
  );
}

/**
 * The messages queued behind the agent's turn, oldest first, standing over
 * its composer in a glass of their own, as the panel's queue dock stands
 * over its box: each on one line led by the panel's queued glyph, with
 * Steer, which sends it into the turn now, and Delete. A long press on a
 * line offers the same with Move Up and Move Down, each only where a line
 * stands to pass, and a line held and dragged takes another place, as a
 * Reminders list's rows do. Why the queue stands paused heads them, with
 * Resume. Note that the lines stand in SwiftUI's own list, so the drag is
 * the system's, and about three stand in sight before the rest scroll, so a
 * long queue, an accessibility size, or the keyboard never pushes the
 * composer off the screen.
 */
export function QueuedLines({
  lines,
  paused,
  onSteer,
  onDelete,
  onMove,
  onResume,
}: QueuedLinesProps) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const press = useScaledSize(PRESS_SIZE);
  const screen = useWindowDimensions();
  const glass = useBarGlass();
  // How tall each message's row stood when last laid out, by its id.
  const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(new Map());

  if (lines.length === 0 && paused === undefined) return null;

  // Note that a row not yet laid out counts as tall as a row of its size stands, so the list never opens short of it.
  const unmeasured = large ? press * LARGE_ROW_PRESSES : press;
  const rows = lines.map((line) => measured.get(line.id) ?? unmeasured);
  const height = sightHeight(rows, screen.height * MOST_OF_WINDOW);

  const measure = (id: string) =>
    onGeometryChange(({ height: next }) =>
      setMeasured((held) => (held.get(id) === next ? held : new Map(held).set(id, next))),
    );

  const rowLook = [
    listRowBackground("clear"),
    listRowInsets({ leading: SPACE.ROW, trailing: SPACE.TIGHT, top: 0, bottom: 0 }),
    listRowSeparator("hidden"),
  ];

  // Note that why the queue paused stands over the list rather than in it, so it takes the height its words wrap to, which no row's measure foretells.
  return (
    <VStack spacing={0} modifiers={[padding({ vertical: SPACE.TIGHT }), ...glass]}>
      {paused === undefined ? null : (
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
      {lines.length === 0 ? null : (
        <List
          modifiers={[
            listStyle("plain"),
            scrollContentBackground("hidden"),
            // Note that the list always scrolls, since past its first few rows, or the window's share, the rest wait below them.
            frame({ height }),
          ]}
        >
          <List.ForEach
            data={lines}
            keyExtractor={(line) => line.id}
            recycling={false}
            {...(onMove === undefined
              ? {}
              : {
                  onMove: (sources: number[], destination: number) => {
                    const from = sources[0];

                    if (from !== undefined) onMove(from, landing(from, destination));
                  },
                })}
          >
            {({ item, index }) => (
              <VStack modifiers={[...rowLook, measure(item.id)]}>
                <QueuedRow
                  line={item}
                  acts={heldActs(item.id, index, lines.length, { onSteer, onDelete, onMove })}
                  onSteer={onSteer}
                  onDelete={onDelete}
                />
              </VStack>
            )}
          </List.ForEach>
        </List>
      )}
    </VStack>
  );
}

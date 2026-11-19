// held-menu.tsx -- the menu a long press opens on a picture, a recording, a file, or a message, as iOS's own apps open one: its acts in the system's menu over the thing lifted.

import { Button, HStack, Image, Menu, RNHostView } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import { accessibilityLabel, buttonStyle, frame } from "@expo/ui/swift-ui/modifiers";
import type { DraftCopy } from "@repo/features/draft-text";
import { dayAndTimeText } from "@repo/features/time-format";
import { createContext, type ReactElement, type ReactNode, useContext, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useScaledSize } from "./accessibility.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { actContent } from "./glyph-label.js";
import { InlineHost } from "./inline-host.js";
import {
  KEEP_ACT,
  KEEP_SYMBOL,
  KEEP_WORDS,
  type KeepAct,
  type Kept,
  keepActs,
} from "./keep-model.js";
import { LongPressMenu, ROW_ACTION_TONE, type RowAction } from "./list-row.js";
import { SelectTextSheet } from "./select-text-sheet.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE } from "./tokens/space.js";

/** What a message's own Copy is called, as the panel's Copy under a message names it. */
const COPY_MESSAGE = "Copy message";

const styles = StyleSheet.create({
  // Note that the menu and its host span the width they stand in, since a host sized by its SwiftUI alone would stand no wider than nothing.
  host: { alignSelf: "stretch" },
});

/** One act of a held thing's menu: its words, its glyph, and what a press does. */
export interface HeldAct {
  readonly label: string;
  readonly symbol: Glyph;
  /** Whether it takes something away for good, which the system draws red, as a queued message's Delete. */
  readonly destructive?: boolean | undefined;
  readonly onPress: () => void;
}

/**
 * What the app does with what is held: opens a picture or a file full
 * screen in the system's Quick Look;
 * copies a picture or a text file's words, saves a picture or a recording to
 * Photos, or shares any of them in the system's share sheet; copies a
 * message's words; and copies a draft's body as rich text, its marks and
 * links kept. The app answers them with the device's own Quick Look,
 * pasteboard, Photos, and share sheet, and says what did not go; nothing
 * here reaches the device.
 */
export interface Keeping {
  readonly open: (kept: Kept) => void;
  readonly keep: (kept: Kept, act: KeepAct) => void;
  readonly copyWords: (words: string) => void;
  /** Shares words in the system's share sheet, such as a message's. */
  readonly shareWords: (words: string) => void;
  readonly copyRich: (copy: DraftCopy) => void;
}

const KeepingDoor = createContext<Keeping | undefined>(undefined);

/** Opens a message's words in the sheet they are selected in, which `KeepingProvider` holds. */
const SelectTextDoor = createContext<((words: string) => void) | undefined>(undefined);

/** Hands every picture, recording, file, and message under it what the app does with what is held, and holds the one sheet a message's Select text opens; none offers no menu. */
export function KeepingProvider({
  keeping,
  children,
}: {
  readonly keeping: Keeping;
  readonly children: ReactNode;
}) {
  const [selecting, setSelecting] = useState<string | undefined>(undefined);

  return (
    <KeepingDoor value={keeping}>
      <SelectTextDoor value={setSelecting}>
        {children}
        <SelectTextSheet words={selecting} onDone={() => setSelecting(undefined)} />
      </SelectTextDoor>
    </KeepingDoor>
  );
}

/** The acts a kept thing's menu offers, in their order; none where nothing is kept yet, or no app answers them. */
export function useKeptActs(kept: Kept | undefined): readonly HeldAct[] {
  const keeping = useContext(KeepingDoor);

  if (keeping === undefined || kept === undefined) return [];

  return keepActs(kept).map((act) => ({
    label: KEEP_WORDS[act],
    symbol: KEEP_SYMBOL[act],
    onPress: () => keeping.keep(kept, act),
  }));
}

/**
 * A thumbnail's press that opens a picture or a file full screen in the
 * system's Quick Look, as Messages and Mail open one; none where nothing is
 * held yet or no app answers it. Note that the preview opens with the
 * system's plain transition rather than growing from the thumbnail, since
 * grown from it Quick Look stood in its immersive mode, its bar and Done
 * hidden until a tap, on the iOS 27.2 iPhone and the iPad alike.
 */
export function useQuickLook(kept: Kept | undefined): (() => void) | undefined {
  const keeping = useContext(KeepingDoor);

  if (keeping === undefined || kept === undefined) return undefined;

  return () => keeping.open(kept);
}

/** The words of a message's acts beyond its Copy, as the panel and iOS's own apps say them. */
const MESSAGE_ACT_WORDS = {
  COPY_LINK: "Copy link",
  SELECT_TEXT: "Select text",
  SHARE: KEEP_WORDS[KEEP_ACT.SHARE],
  MORE: "More",
} as const;

/**
 * A message's acts, in the panel's order and then iOS's own: Copy, Copy
 * link where the message has an address, then Select text and Share, as
 * Messages and ChatGPT offer them on a held message, with what the message
 * offers of its own after Copy link, such as the panel's Edit; none for a
 * message of no words, or where no app answers them.
 */
function useMessageActs(
  words: string,
  link: string | undefined,
  more: readonly HeldAct[],
): readonly HeldAct[] {
  const keeping = useContext(KeepingDoor);
  const selectText = useContext(SelectTextDoor);

  if (keeping === undefined || words.trim() === "") return [];

  return [
    { label: COPY_MESSAGE, symbol: GLYPH.COPY, onPress: () => keeping.copyWords(words) },
    ...(link === undefined
      ? []
      : [
          {
            label: MESSAGE_ACT_WORDS.COPY_LINK,
            symbol: GLYPH.LINK,
            onPress: () => keeping.copyWords(link),
          },
        ]),
    ...more,
    ...(selectText === undefined
      ? []
      : [
          {
            label: MESSAGE_ACT_WORDS.SELECT_TEXT,
            symbol: GLYPH.SELECT_TEXT,
            onPress: () => selectText(words),
          },
        ]),
    {
      label: MESSAGE_ACT_WORDS.SHARE,
      symbol: GLYPH.SHARE,
      onPress: () => keeping.shareWords(words),
    },
  ];
}

/**
 * A line of the member's own, or a teammate's, that a long press lifts and
 * opens SwiftUI's own menu on, as Messages and ChatGPT open one on a sent
 * bubble: headed by when it was sent ("Oct 11, 2:14 PM"), then Copy, Copy
 * link where it has an address, Select text, and Share; the line alone where
 * it has no words.
 */
export function MessageMenu({
  words,
  at,
  link,
  more = [],
  width,
  children,
}: {
  readonly words: string;
  /** When it was sent; none where its line kept no time. */
  readonly at: number | undefined;
  /** Its address on vespin.dev, which Copy link copies; none where it has none. */
  readonly link?: string | undefined;
  /** What it offers of its own after Copy link, in the panel's order, such as Edit. */
  readonly more?: readonly HeldAct[] | undefined;
  /** The width it stands in where the caller knows it before it is laid out (`HeldMenu`'s `width`). */
  readonly width?: number | undefined;
  readonly children: ReactElement;
}) {
  return (
    <HeldMenu
      acts={useMessageActs(words, link, more)}
      title={at === undefined ? undefined : dayAndTimeText(at)}
      width={width}
    >
      {children}
    </HeldMenu>
  );
}

/**
 * The acts under an agent's finished turn, standing as a quiet row of the
 * panel's glyphs rather than on a hover, which a phone has none of, as
 * ChatGPT's row stands under its reply: Copy, Copy link where the turn has
 * an address, then Share, each a 44 pt target in the muted ink, named for
 * VoiceOver by its words, and a ⋯ holding what else the turn offers, in the
 * system's menu; for a turn of no words, Copy link and the ⋯ alone, and
 * nothing where it offers no more.
 */
export function TurnActs({
  words,
  link,
  more = [],
}: {
  readonly words: string;
  readonly link?: string | undefined;
  /** What the turn offers past its row, in the panel's order, such as Fork to new agent, behind a ⋯ at the row's end. */
  readonly more?: readonly HeldAct[] | undefined;
}) {
  const colors = useColors();
  const keeping = useContext(KeepingDoor);
  const size = useScaledSize(MARK_SIZE.GLYPH);

  const copyable = words.trim() !== "";

  // Note that a turn of no words still stands its row where it offers more, such as Fork to new agent, as the panel's foot does.
  if (keeping === undefined || (!copyable && more.length === 0)) return null;

  const acts: readonly HeldAct[] = [
    ...(copyable
      ? [{ label: COPY_MESSAGE, symbol: GLYPH.COPY, onPress: () => keeping.copyWords(words) }]
      : []),
    ...(link === undefined
      ? []
      : [
          {
            label: MESSAGE_ACT_WORDS.COPY_LINK,
            symbol: GLYPH.LINK,
            onPress: () => keeping.copyWords(link),
          },
        ]),
    ...(copyable
      ? [
          {
            label: MESSAGE_ACT_WORDS.SHARE,
            symbol: GLYPH.SHARE,
            onPress: () => keeping.shareWords(words),
          },
        ]
      : []),
  ];

  return (
    <InlineHost matchContents>
      <HStack spacing={0}>
        {acts.map((act) => (
          <Button
            key={act.label}
            onPress={act.onPress}
            modifiers={[buttonStyle("borderless"), accessibilityLabel(act.label)]}
          >
            <Image
              {...glyphImage(act.symbol)}
              size={size}
              color={colors.TEXT_MUTED}
              modifiers={[
                frame({ minWidth: PRESS_SIZE, minHeight: PRESS_SIZE }),
                SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
              ]}
            />
          </Button>
        ))}
        {more.length === 0 ? null : (
          <Menu
            label={
              <Image
                {...glyphImage(GLYPH.MORE)}
                size={size}
                color={colors.TEXT_MUTED}
                modifiers={[
                  frame({ minWidth: PRESS_SIZE, minHeight: PRESS_SIZE }),
                  SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
                ]}
              />
            }
            modifiers={[accessibilityLabel(MESSAGE_ACT_WORDS.MORE)]}
          >
            {more.map((act) => (
              <Button
                key={act.label}
                {...actContent(act.label, act.symbol)}
                onPress={act.onPress}
                {...(act.destructive === true ? { role: "destructive" as const } : {})}
              />
            ))}
          </Menu>
        )}
      </HStack>
    </InlineHost>
  );
}

/** What the app does with what is held, for a piece that copies on a press of its own, such as a draft's Copy; none where no app answers it. */
export function useKeeping(): Keeping | undefined {
  return useContext(KeepingDoor);
}

/** A held thing's act as the long press menu takes it: red where it takes something away for good. */
function heldItem(act: HeldAct): RowAction {
  return {
    label: act.label,
    symbol: act.symbol,
    tone: act.destructive === true ? ROW_ACTION_TONE.DESTRUCTIVE : ROW_ACTION_TONE.NEUTRAL,
    onPress: act.onPress,
  };
}

/**
 * SwiftUI content a long press opens its acts on, lifted as the system lifts
 * a held thing, such as a thread's message; the content alone where it
 * offers none.
 */
export function HeldSwiftMenu({
  acts,
  title,
  children,
}: {
  readonly acts: readonly HeldAct[];
  /** What heads the menu, such as when a message was sent. */
  readonly title?: string | undefined;
  readonly children: ReactElement;
}) {
  return (
    <LongPressMenu groups={[acts.map(heldItem)]} title={title}>
      {children}
    </LongPressMenu>
  );
}

/**
 * React Native views a long press opens its acts on, as Photos and Messages
 * open one on a picture: SwiftUI's own menu, hosted at the width the views
 * stand in and the height they draw, the views hosted back inside it, so a
 * press still reaches them. The views alone where they offer no act. Note
 * that the hosted views stand in a box exactly as wide as the row offers,
 * measured outside the host, because a host that takes its height from its
 * views lays them out with no width of its own, so a view sized by a share
 * of its width, such as a picture's or a recording's well at its shape,
 * stood at no height at all.
 */
export function HeldMenu({
  acts,
  title,
  width: known,
  children,
}: {
  readonly acts: readonly HeldAct[];
  /** What heads the menu, such as when a message was sent. */
  readonly title?: string | undefined;
  /** The width the held views stand in where the caller knows it before they are laid out, as a transcript's row does, so they are bounded from their first frame; else the width the menu measures where it stands. */
  readonly width?: number | undefined;
  readonly children: ReactElement;
}) {
  const [measured, setWidth] = useState<number | undefined>(undefined);
  // Note that a width known up front bounds the views on their first layout, since one measured comes a frame later, and the views laid out unbounded in that frame stood one line wide past the screen, their host's height a step behind their words.
  const width = known ?? measured;

  if (acts.length === 0) return children;

  return (
    <View style={styles.host} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <InlineHost matchContents={{ vertical: true }} style={styles.host}>
        <HeldSwiftMenu acts={acts} title={title}>
          <RNHostView matchContents={{ vertical: true }}>
            <View style={width === undefined ? undefined : { width }}>{children}</View>
          </RNHostView>
        </HeldSwiftMenu>
      </InlineHost>
    </View>
  );
}

/** A message's React Native views, whose long press offers Copy message, Select text and Share; the views alone for a message of no words. */
export function CopyWordsMenu({
  words,
  width,
  children,
}: {
  readonly words: string;
  /** The width the message stands in where the caller knows it before it is laid out (`HeldMenu`'s `width`). */
  readonly width?: number | undefined;
  readonly children: ReactElement;
}) {
  return (
    <HeldMenu acts={useMessageActs(words, undefined, [])} width={width}>
      {children}
    </HeldMenu>
  );
}

/** A message drawn in SwiftUI, such as a thread's, whose long press offers Copy message, Select text and Share; the message alone where it has no words. */
export function CopyWordsSwiftMenu({
  words,
  children,
}: {
  readonly words: string;
  readonly children: ReactElement;
}) {
  return <HeldSwiftMenu acts={useMessageActs(words, undefined, [])}>{children}</HeldSwiftMenu>;
}

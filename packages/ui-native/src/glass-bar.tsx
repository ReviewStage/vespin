// glass-bar.tsx -- the Liquid Glass bar a composer stands in at a screen's foot, and the dock that pins it there above the keyboard.

import { GlassEffectContainer, Host, HStack, ScrollView, VStack } from "@expo/ui/swift-ui";
import { frame, type ModifierConfig, onGeometryChange, padding } from "@expo/ui/swift-ui/modifiers";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import {
  Keyboard,
  type LayoutChangeEvent,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useReduceTransparency } from "./accessibility.js";
import { useColors } from "./tokens/colors.js";
import { READING_WIDTH, SPACE } from "./tokens/space.js";

/** The room a docked bar takes above the screen's bottom safe area before it is measured, in points: a bare field's, with its gap. */
const DOCK_ROOM_UNMEASURED = 72;

/** The room the dock a screen's content stands in takes at its foot, above the bottom safe area, in points; none outside a dock. */
const DockRoom = createContext(0);

/** Tells the dock how tall the bar inside it stands, with its gap; nothing outside a dock. */
const DockMeasure = createContext<((room: number) => void) | undefined>(undefined);

/** How far apart the controls of a row with no bar stand (`DockRow`), as the glass buttons over Notes' keyboard stand apart. */
const DOCK_ROW_SPACING = SPACE.TIGHT * 2;

/** How round the bar stands: a rounded field, as a composer's is. */
export const BAR_RADIUS = 24;

/**
 * How far the bar's row stands in from its edge: little, since the row's
 * presses carry frames of a press's size (`PRESS_SIZE`), which stand them as
 * far in as the bar's edge did before, so the bar draws as it did while each
 * press takes Apple's least target.
 */
export const BAR_EDGE = 2;

/** How far apart the row's pieces stand: not at all, since a press's frame holds the room around its mark that the row's spacing held before. */
export const BAR_ROW_SPACING = 0;

/** How far what heads the bar, such as queued messages, stands in from its edge, where the row's marks stand in theirs. */
export const BAR_HEAD_INSET = {
  leading: SPACE.ROW + 2,
  trailing: SPACE.TIGHT + 2,
  top: SPACE.TIGHT + 2,
} as const;

/** The most of the window's height what heads a bar takes before it scrolls inside the bar, so the content under the bar stays in reach at the largest text sizes. */
const HEAD_SHARE = 0.35;

const styles = StyleSheet.create({
  // The bar's own gap above the tab bar, or the keyboard.
  gap: { paddingBottom: SPACE.ROW },
  // The bar's SwiftUI takes the bar's width and its own height.
  content: { flexGrow: 1 },
  // A dock's content takes the screen, the bar floating over its foot.
  dock: { flex: 1 },
  docked: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center" },
  // The bar's column, as wide as the dock and no wider than the reading width a wide window centers its content at.
  column: { width: "100%" },
  // A row with no bar stands in from the screen's edges as far as a bar does.
  row: { marginHorizontal: SPACE.ROW + 2 },
  bar: {
    marginHorizontal: SPACE.ROW + 2,
    padding: BAR_EDGE,
    borderRadius: BAR_RADIUS,
  },
});

/** How tall the system's keyboard stands, in points, as it begins to rise and to fall; none while it is down. */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const rising = Keyboard.addListener("keyboardWillShow", ({ endCoordinates }) =>
      setHeight(endCoordinates.height),
    );

    const falling = Keyboard.addListener("keyboardWillHide", () => setHeight(0));

    return () => {
      rising.remove();
      falling.remove();
    };
  }, []);

  return height;
}

/**
 * A bar's solid stand-in for glass: the surface's ground inside the strong
 * edge, which holds the field's bounds apart from the screen behind it.
 */
function SolidBar({ children }: { readonly children: ReactNode }) {
  const colors = useColors();

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.SURFACE,
          borderColor: colors.TEXT_MUTED,
          borderWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      {children}
    </View>
  );
}

/**
 * What heads a bar inside its glass, such as a composer's held call and
 * queued messages, inset as the row's marks are. Note that it scrolls in
 * place once it would stand taller than a share of the window
 * (`HEAD_SHARE`), because at the largest text sizes a held call's words and
 * its Deny and Allow alone grew the bar over the whole screen it docks on.
 */
export function BarHead({ children }: { readonly children: ReactNode }) {
  const { height: window } = useWindowDimensions();
  const [tall, setTall] = useState(0);
  const most = Math.round(window * HEAD_SHARE);

  const stack = (
    <VStack
      alignment="leading"
      modifiers={[padding(BAR_HEAD_INSET), onGeometryChange(({ height }) => setTall(height))]}
    >
      {children}
    </VStack>
  );

  return tall > most ? (
    <ScrollView modifiers={[frame({ height: most })]}>{stack}</ScrollView>
  ) : (
    stack
  );
}

/**
 * What a dock pins at its foot, standing in the screen's bottom safe area,
 * and telling its dock how tall it stands, its gap with it, as it grows and
 * shrinks, so the content under it scrolls clear of all of it. Note that the
 * bottom safe area is let go while the keyboard stands, since the keyboard
 * covers the tab bar it holds room for; the sides are kept, so it stops
 * short of a tab rail beside it, as the folded iPhone Duo stands one.
 */
function DockedFoot({ children }: { readonly children: ReactNode }) {
  const keyboard = useKeyboardHeight() > 0;
  const measure = useContext(DockMeasure);

  const onLayout =
    measure === undefined
      ? undefined
      : (event: LayoutChangeEvent) => measure(event.nativeEvent.layout.height + SPACE.ROW);

  return (
    <SafeAreaView
      edges={keyboard ? ["left", "right"] : ["bottom", "left", "right"]}
      style={styles.gap}
    >
      <View onLayout={onLayout}>{children}</View>
    </SafeAreaView>
  );
}

/**
 * A bar of glass holding a composer's field and its buttons, floating over
 * the content it scrolls above, as the system's own bars do. Its children
 * are SwiftUI pieces, laid in a row on a host of its own, under its head
 * where it has one. It stands inside
 * the screen's bottom safe area, which the tab bar's height is part of, so
 * the bar sits above the tab bar rather than under it. Note that where
 * Liquid Glass is unavailable, before iOS 26, or the reader turned on Reduce
 * Transparency, the bar is drawn solid on the surface's ground inside the
 * quiet ink rather than a hand-drawn copy of glass, so nothing scrolls
 * through behind its words.
 */
export function GlassBar({
  children,
  head,
  modifiers = [],
}: {
  readonly children: ReactNode;
  /** What stands over the row inside the same glass, such as a composer's queued messages and attached pictures; nothing where none is given. */
  readonly head?: ReactNode;
  /** What the bar's SwiftUI takes over its whole glass, such as a drop of pictures. */
  readonly modifiers?: readonly ModifierConfig[];
}) {
  const solid = useReduceTransparency() || !isLiquidGlassAvailable();

  const row = (
    <HStack spacing={BAR_ROW_SPACING} modifiers={head === undefined ? [...modifiers] : []}>
      {children}
    </HStack>
  );

  const content = (
    <Host matchContents={{ vertical: true }} style={styles.content}>
      {head === undefined ? (
        row
      ) : (
        <VStack alignment="leading" spacing={SPACE.TIGHT * 2} modifiers={[...modifiers]}>
          <BarHead>{head}</BarHead>
          {row}
        </VStack>
      )}
    </Host>
  );

  const bar = solid ? (
    <SolidBar>{content}</SolidBar>
  ) : (
    <GlassView glassEffectStyle="regular" style={styles.bar}>
      {content}
    </GlassView>
  );

  return <DockedFoot>{bar}</DockedFoot>;
}

/**
 * A row of controls a dock pins at its foot with no bar around them, each
 * control standing in the system's own glass, one layer, as the controls
 * over the keyboard in Notes and Reminders stand: a compose sheet's + and
 * its capsule menus. Its children are SwiftUI pieces drawn with a glass
 * button style (`buttonStyle("glass")`), laid in a row inside the system's
 * glass container, so neighbors draw as one family of glass rather than a
 * glass inside a glass. Note that the system's glass styles stand solid on
 * their own where the reader turned on Reduce Transparency, so the row needs
 * no stand-in of its own.
 */
export function DockRow({
  children,
  modifiers = [],
}: {
  readonly children: ReactNode;
  /** What the row's SwiftUI takes over its whole width, such as a drop of pictures. */
  readonly modifiers?: readonly ModifierConfig[];
}) {
  return (
    <DockedFoot>
      <Host matchContents={{ vertical: true }} style={[styles.content, styles.row]}>
        <GlassEffectContainer spacing={DOCK_ROW_SPACING} modifiers={[...modifiers]}>
          <HStack spacing={DOCK_ROW_SPACING}>{children}</HStack>
        </GlassEffectContainer>
      </Host>
    </DockedFoot>
  );
}

/**
 * A screen with a bar pinned at its foot, such as a thread's composer: the
 * screen's content fills it, the bar floating over its foot as the system's
 * bars do, and rising with the keyboard so the field stays above it. The
 * content leaves room at its own foot for the bar as tall as it stands
 * (`useDockRoom`): a composer's head, such as a call waiting on an answer
 * and the queue, grows it well past a bare field. In a wide window the bar
 * stands in the content's own centered column, at the reading width, as
 * Messages' field stands under its conversation, rather than across the
 * whole window.
 */
export function GlassDock({
  children,
  bar,
}: {
  readonly children: ReactNode;
  readonly bar: ReactNode;
}) {
  // Note that the bar is lifted by the keyboard's own height, read from the system, rather than by a view that pads for it, since the field that raised it stands in SwiftUI.
  const keyboard = useKeyboardHeight();
  const [room, setRoom] = useState(DOCK_ROOM_UNMEASURED);
  // Note that the column holds the window's side safe areas too, which the bar's own safe area view pads inside it, so its glass spans the reading width.
  const { left, right } = useSafeAreaInsets();

  return (
    <View style={styles.dock}>
      <DockRoom.Provider value={room}>{children}</DockRoom.Provider>
      <View style={[styles.docked, { bottom: keyboard }]}>
        <View style={[styles.column, { maxWidth: READING_WIDTH + left + right }]}>
          <DockMeasure.Provider value={setRoom}>{bar}</DockMeasure.Provider>
        </View>
      </View>
    </View>
  );
}

/** The room the dock a screen's content stands in takes at its foot, above the bottom safe area, which the content leaves under its last row so it scrolls clear of the bar; none outside a dock. */
export function useDockRoom(): number {
  return useContext(DockRoom);
}

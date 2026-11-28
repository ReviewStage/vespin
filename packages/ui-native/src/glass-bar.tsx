// glass-bar.tsx -- the Liquid Glass bar a composer stands in at a screen's foot, and the dock that pins it there above the keyboard.

import { Host, HStack, ScrollView, VStack } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  defaultScrollAnchorForRole,
  frame,
  glassEffect,
  type ModifierConfig,
  onGeometryChange,
  padding,
  scrollDisabled,
} from "@expo/ui/swift-ui/modifiers";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import {
  Keyboard,
  type KeyboardEvent,
  LayoutAnimation,
  type LayoutChangeEvent,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardDockArea } from "./keyboard-dock.js";
import { useColors } from "./tokens/colors.js";
import { PRESS_SIZE, READING_WIDTH, SPACE } from "./tokens/space.js";

/** The room a docked bar takes above the screen's bottom safe area before it is measured, in points: a bare field's, with its gap. */
const DOCK_ROOM_UNMEASURED = 72;

/** The room the dock a screen's content stands in takes at its foot, above the bottom safe area, in points; none outside a dock. */
const DockRoom = createContext(0);

/** How far the system's keyboard stands over the dock a screen's content stands in, in points; none while it is down or outside a dock. */
const DockKeyboard = createContext(0);

/** Whether the dock the bar stands in lifts it natively, clear of the bottom safe area it keeps standing over; none outside the native dock. */
const DockLifted = createContext(false);

/** The bottom safe area the native dock lifts the bar less by, as it tells it, which the bar's foot pads by so the two are one number; none before the dock tells it, or outside it. */
const DockInset = createContext<number | undefined>(undefined);

/** Tells the dock how tall the bar inside it stands, with its gap, and where its top stands in the window; nothing outside a dock. */
const DockMeasure = createContext<((room: number) => void) | undefined>(undefined);

/** How round the bar stands: a rounded field, as a composer's is. */
export const BAR_RADIUS = 24;

/**
 * How far the bar's row stands in from its edge: little, since the row's
 * presses carry frames of a press's size (`PRESS_SIZE`), which stand them as
 * far in as the bar's edge did before, so the bar draws as it did while each
 * press takes Apple's least target.
 */
export const BAR_EDGE = 2;

/** How far the bar stands in from its column's edges, so what stands over its end, such as Jump to latest, can stand over its last press. */
export const BAR_MARGIN = SPACE.ROW + 2;

/** How far apart the row's pieces stand: not at all, since a press's frame holds the room around its mark that the row's spacing held before. */
export const BAR_ROW_SPACING = 0;

/** How far what stands under a bar's row, such as a composer's capsules and Send under its field, stands from the row: one tight step, since its presses' frames already stand their marks well clear of the words. */
export const BAR_FOOT_GAP = SPACE.TIGHT;

/** How far what heads the bar, such as queued messages, stands in from its edge, where the row's marks stand in theirs. */
export const BAR_HEAD_INSET = {
  leading: SPACE.ROW + 2,
  trailing: SPACE.TIGHT + 2,
  top: SPACE.TIGHT + 2,
} as const;

/** The most of the window's height above the keyboard what heads a bar takes before it scrolls inside the bar, so the content under the bar stays in reach at the largest text sizes and with the keyboard up. */
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
  // What stands over a bar in a glass of its own, apart from it, across the bar's column, insetting its own content as far as the bar stands in, so a row that scrolls sideways is never cut at the bar's edge.
  above: { marginBottom: SPACE.TIGHT * 2 },
  // The bar stands in from the screen's edges, its glass drawn by its SwiftUI.
  bar: { marginHorizontal: BAR_MARGIN },
});

/**
 * Moves the next layout with the keyboard, on its own duration and curve, as
 * React Native's keyboard-avoiding view does, so what the keyboard lifts
 * rises with it rather than snapping to where it ends.
 */
function moveWithKeyboard({ duration, easing }: KeyboardEvent) {
  if (duration <= 0) return;
  LayoutAnimation.configureNext({
    duration,
    update: { duration, type: LayoutAnimation.Types[easing] ?? LayoutAnimation.Types.keyboard },
  });
}

/** How tall the system's keyboard stands, in points, as it begins to rise and to fall; none while it is down. Where `moves` is given, the next layout moves with the keyboard on its own curve. Note that it starts from the keyboard standing as it mounts, so a piece drawn while the keyboard is up, such as a composer's head a refused send adds, reads it at once rather than at the keyboard's next move. */
export function useKeyboardHeight(moves = true): number {
  const [height, setHeight] = useState(() =>
    Keyboard.isVisible() ? (Keyboard.metrics()?.height ?? 0) : 0,
  );

  useEffect(() => {
    const rising = Keyboard.addListener("keyboardWillShow", (event) => {
      if (moves) moveWithKeyboard(event);
      setHeight(event.endCoordinates.height);
    });

    const falling = Keyboard.addListener("keyboardWillHide", (event) => {
      if (moves) moveWithKeyboard(event);
      setHeight(0);
    });

    // Note that the height is read again once the keyboard has stood or gone, since a piece mounted while it moved read where it stood before, which React Native holds until the move ends.
    const stood = Keyboard.addListener("keyboardDidShow", (event) =>
      setHeight(event.endCoordinates.height),
    );

    const gone = Keyboard.addListener("keyboardDidHide", () => setHeight(0));

    return () => {
      rising.remove();
      falling.remove();
      stood.remove();
      gone.remove();
    };
  }, [moves]);

  return height;
}

/** The filled ground a field's row and what heads it stand on inside the glass, so their words read over a bright picture scrolling under the bar. */
function useFieldGround(radius: number): readonly ModifierConfig[] {
  const colors = useColors();

  return [
    SwiftModifiers.background(
      colors.RAISED,
      SwiftModifiers.shapes.roundedRectangle({ cornerRadius: radius }),
    ),
  ];
}

/**
 * The glass a SwiftUI piece floating over the screen stands in, rounded as a
 * bar is, such as a composer's bar, the failure notice and a split view's
 * composer: the system's own glass, which iOS draws solid where the reader
 * turned on Reduce Transparency.
 */
export const BAR_GLASS: readonly ModifierConfig[] = [
  glassEffect({
    glass: { variant: "regular" },
    // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- @expo/ui names this parameter `shape`.
    shape: "roundedRectangle",
    cornerRadius: BAR_RADIUS,
  }),
];

/**
 * What heads a bar inside its glass, such as a composer's held call and
 * queued messages, inset as the row's marks are. Note that it scrolls in
 * place once it would stand taller than a share of the window the keyboard
 * leaves (`HEAD_SHARE`), one scroll view throughout so what it holds is
 * never drawn anew as it crosses the share, because at the largest text sizes a held call's
 * words and its Deny and Allow alone grew the bar over the whole screen it
 * docks on, and with the keyboard up on the folded iPhone Duo a share of the
 * whole window left the transcript a line or two.
 */
export function BarHead({
  children,
  filled = false,
}: {
  readonly children: ReactNode;
  /** Whether it stands on the field's filled ground, as the field's row does inside the glass, so its words read over a bright picture scrolling under the bar. */
  readonly filled?: boolean;
}) {
  const { height: window } = useWindowDimensions();
  const keyboard = useKeyboardHeight(false);
  const [tall, setTall] = useState(0);
  const most = Math.round(Math.max(0, window - keyboard) * HEAD_SHARE);
  const ground = useFieldGround(BAR_RADIUS - BAR_EDGE);

  // Note that a filled head spans the bar's width, as the field's pill under it does, rather than hugging its words.
  const fill = filled
    ? [frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }), ...ground]
    : [];

  const scrolls = tall > most;

  // Note that the head is always the same scroll view, its height its words' own up to the share and no taller, scrolling only past it, because swapping a plain stack for a scroll view as the head crossed the share remounted what it holds: a field in it, such as an ask's, lost the keyboard the moment the keyboard's rise shrank the share.
  return (
    <ScrollView
      modifiers={[
        // Note that the scroll view stands as tall as its words, measured, and no taller than the share. Its modifiers keep one shape whatever the height, a frame with a height always set, since `@expo/ui` wraps each modifier in its own view and SwiftUI's frame takes another branch without a height: either change drew the head anew and let a focused field go of the keyboard.
        frame({ height: Math.min(tall, most) }),
        scrollDisabled(!scrolls),
        // Note that a head that scrolls keeps to its foot as it grows or the keyboard shrinks it, so a note under what it holds, such as why an ask's answer did not go, and the field it is about stand in sight.
        defaultScrollAnchorForRole("bottom", "sizeChanges"),
        ...fill,
      ]}
    >
      <VStack
        alignment="leading"
        modifiers={[padding(BAR_HEAD_INSET), onGeometryChange(({ height }) => setTall(height))]}
      >
        {children}
      </VStack>
    </ScrollView>
  );
}

/**
 * What a dock pins at its foot, standing in the screen's bottom safe area,
 * and telling its dock how tall it stands, its gap with it, as it grows and
 * shrinks, so the content under it scrolls clear of all of it.
 */
function DockedFoot({ children }: { readonly children: ReactNode }) {
  const keyboard = useKeyboardHeight() > 0;
  const lifted = useContext(DockLifted);
  const inset = useContext(DockInset);
  const measure = useContext(DockMeasure);
  // Note that inside the native dock the foot pads by the bottom safe area the dock tells, the one its lift is less by, rather than one React Native reads for itself, since on a page presented full screen, such as New task, the two differed by the home indicator and the bar stood that far short of the keyboard.
  const told = lifted && inset !== undefined;

  const onLayout =
    measure === undefined
      ? undefined
      : (event: LayoutChangeEvent) => measure(event.nativeEvent.layout.height + SPACE.ROW);

  // Note that the bottom safe area is let go while the keyboard stands, since the keyboard covers the tab bar it holds room for; the sides are kept, so the bar stops short of a tab rail beside it, as the folded iPhone Duo stands one. The native dock lifts the bar only as far past that safe area as the keyboard stands, so the bar keeps it throughout, and a drag that pulls the keyboard down lowers the bar without a jump at its end.
  return (
    <SafeAreaView
      edges={told || (keyboard && !lifted) ? ["left", "right"] : ["bottom", "left", "right"]}
      style={told ? [styles.gap, { paddingBottom: SPACE.ROW + inset }] : styles.gap}
    >
      <View onLayout={onLayout}>{children}</View>
    </SafeAreaView>
  );
}

/**
 * A bar of glass holding a composer's field and its buttons, floating over
 * the content it scrolls above, as the system's own bars do. Its children
 * are SwiftUI pieces, laid in a row on a host of its own, under its head
 * where it has one, along the row's foot, so a field grown past one line
 * keeps its buttons beside its last line, as Messages' do, and over what
 * stands under the row, such as a start's capsules, over which the field
 * stands alone at the bar's width. It stands inside
 * the screen's bottom safe area, which the tab bar's height is part of, so
 * the bar sits above the tab bar rather than under it. Its glass is the
 * system's own (`BAR_GLASS`) on its SwiftUI, which iOS draws solid where
 * the reader turned on Reduce Transparency.
 */
export function GlassBar({
  children,
  head,
  foot,
  above,
  modifiers = [],
  field = false,
  heads = false,
}: {
  readonly children: ReactNode;
  /** What stands under the row inside the same glass, such as the capsules saying where a start runs; nothing where none is given. */
  readonly foot?: ReactNode;
  /** SwiftUI standing over the bar in a glass of its own, such as an agent's queued messages, as the panel stands its queue over its box, across the bar's whole column, its content inset as far as the bar stands in (`BAR_MARGIN`); nothing where none is given. */
  readonly above?: ReactNode;
  /** Whether the row is a field with its presses, which stands on a filled pill inside the glass, as Messages stands its field, so its placeholder and glyphs read over a bright picture scrolling under the bar. */
  readonly field?: boolean;
  /** What stands over the row inside the same glass, such as a composer's queued messages and attached pictures; nothing where none is given. */
  readonly head?: ReactNode;
  /** What the bar's SwiftUI takes over its whole glass, such as a drop of pictures. */
  readonly modifiers?: readonly ModifierConfig[];
  /** Whether a head may come and go over a row that must never be drawn anew, such as a field of pills holding the keyboard: the bar then keeps the column a head stands in even while none does. */
  readonly heads?: boolean;
}) {
  const ground = useFieldGround(PRESS_SIZE / 2);
  const pill = field ? ground : [];

  // Note that the glass spans the bar's width whatever its row holds, as the bar always has.
  const glass = [
    frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
    padding({ all: BAR_EDGE }),
    ...BAR_GLASS,
  ];

  // Note that a bar whose head comes and goes keeps one shape, because a row moved into a column is drawn anew, and a field drawn anew lets go of the keyboard between one key and the next.
  const alone = !heads && head === undefined && foot === undefined;
  const rowModifiers = alone ? [...modifiers, ...pill, ...glass] : [...pill];

  // Note that a row over a foot holds the field alone, so it stands in a column that hands it the bar's width as it is, rather than a row that sizes the field's text view again for each width it tries.
  const row =
    foot === undefined ? (
      <HStack alignment="bottom" spacing={BAR_ROW_SPACING} modifiers={rowModifiers}>
        {children}
      </HStack>
    ) : (
      <VStack alignment="leading" spacing={BAR_ROW_SPACING} modifiers={rowModifiers}>
        {children}
      </VStack>
    );

  const bar = (
    <Host matchContents={{ vertical: true }} style={[styles.content, styles.bar]}>
      {alone ? (
        row
      ) : (
        <VStack alignment="leading" spacing={SPACE.TIGHT * 2} modifiers={[...modifiers, ...glass]}>
          {head === undefined ? null : <BarHead filled={field}>{head}</BarHead>}
          {foot === undefined ? (
            row
          ) : (
            <VStack alignment="leading" spacing={BAR_FOOT_GAP}>
              {row}
              {foot}
            </VStack>
          )}
        </VStack>
      )}
    </Host>
  );

  return (
    <DockedFoot>
      {above === undefined ? null : (
        <Host matchContents={{ vertical: true }} style={[styles.content, styles.above]}>
          {above}
        </Host>
      )}
      {bar}
    </DockedFoot>
  );
}

/** What a dock holds: the screen's content, and the bar pinned over its foot. */
interface DockProps {
  readonly children: ReactNode;
  readonly bar: ReactNode;
}

/** The bar's column at the dock's foot, at the reading width in a wide window. */
function DockColumn({
  bar,
  onRoom,
}: {
  readonly bar: ReactNode;
  readonly onRoom: (room: number) => void;
}) {
  // Note that the column holds the window's side safe areas too, which the bar's own safe area view pads inside it, so its glass spans the reading width.
  const { left, right } = useSafeAreaInsets();

  return (
    <View style={[styles.column, { maxWidth: READING_WIDTH + left + right }]}>
      <DockMeasure value={onRoom}>{bar}</DockMeasure>
    </View>
  );
}

/**
 * A screen with a bar pinned at its foot, such as a thread's composer: the
 * screen's content fills it, the bar floating over its foot as the system's
 * bars do, and rising with the keyboard so the field stays above it. The
 * content leaves room at its own foot for the bar as tall as it stands
 * (`useDockRoom`): a composer's head, such as a call waiting on an answer
 * and the queue, grows it well past a bare field, and for the keyboard as far
 * as it stands over the dock (`useDockKeyboard`). In a wide window the bar
 * stands in the content's own centered column, at the reading width, as
 * Messages' field stands under its conversation, rather than across the
 * whole window. The app's native dock (`keyboard-dock.ts`) lifts the bar
 * with the keyboard frame by frame, through a drag that pulls the keyboard
 * down, the suggestion strip's growth, and a form sheet's own lift, so a list
 * over it may lower the keyboard under the reader's finger; the bar stands
 * last in it, since the native dock lifts its last child.
 */
export function GlassDock({ children, bar }: DockProps) {
  const [overlap, setOverlap] = useState(0);
  const [inset, setInset] = useState<number | undefined>(undefined);
  const [room, setRoom] = useState(DOCK_ROOM_UNMEASURED);

  return (
    <KeyboardDockArea
      style={styles.dock}
      onOverlap={(event) => {
        setOverlap(event.nativeEvent.overlap);
        setInset(event.nativeEvent.inset);
      }}
    >
      <DockKeyboard value={overlap}>
        <DockRoom value={room}>{children}</DockRoom>
      </DockKeyboard>
      {/* Note that the docked view is never flattened away, since the native dock lifts its last child, which must be this view and not whatever the bar mounts first. */}
      <View style={styles.docked} collapsable={false}>
        <DockLifted value={true}>
          <DockInset value={inset}>
            <DockColumn bar={bar} onRoom={setRoom} />
          </DockInset>
        </DockLifted>
      </View>
    </KeyboardDockArea>
  );
}

/** The room the dock a screen's content stands in takes at its foot, above the bottom safe area, which the content leaves under its last row so it scrolls clear of the bar; none outside a dock. */
export function useDockRoom(): number {
  return useContext(DockRoom);
}

/** How far the system's keyboard stands over the dock a screen's content stands in, which the dock's bar is lifted by, so the content keeps its foot clear of it; none while it is down or outside a dock. */
export function useDockKeyboard(): number {
  return useContext(DockKeyboard);
}

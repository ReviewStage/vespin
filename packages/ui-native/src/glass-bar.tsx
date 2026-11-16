// glass-bar.tsx -- the Liquid Glass bar a composer stands in at a screen's foot, and the dock that pins it there above the keyboard.

import { GlassEffectContainer, Host, HStack, ScrollView, VStack } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  background,
  frame,
  glassEffect,
  type ModifierConfig,
  onGeometryChange,
  padding,
  strokeBorder,
} from "@expo/ui/swift-ui/modifiers";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type HostInstance,
  Keyboard,
  type KeyboardEvent,
  LayoutAnimation,
  type LayoutChangeEvent,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useReduceTransparency } from "./accessibility.js";
import { KeyboardDockArea } from "./keyboard-dock.js";
import { useNoticeLift } from "./notice-lift.js";
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

/** Tells the dock how tall the bar inside it stands, with its gap, and where its top stands in the window; nothing outside a dock. */
const DockMeasure = createContext<((room: number, top: number) => void) | undefined>(undefined);

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
  row: { marginHorizontal: SPACE.ROW + 2 },
  bar: {
    marginHorizontal: SPACE.ROW + 2,
    padding: BAR_EDGE,
    borderRadius: BAR_RADIUS,
  },
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
 * bar is, such as the failure notice and a split view's composer: the
 * system's glass, or, where Liquid Glass is unavailable or the reader turned
 * on Reduce Transparency, the same solid stand-in a `GlassBar` draws, the
 * surface's ground inside the quiet ink's hairline, rather than whatever the
 * system makes of glass the reader asked not to see through.
 */
export function useBarGlass(): readonly ModifierConfig[] {
  const colors = useColors();
  const solid = useReduceTransparency() || !isLiquidGlassAvailable();

  return solid
    ? [
        background(
          colors.SURFACE,
          SwiftModifiers.shapes.roundedRectangle({ cornerRadius: BAR_RADIUS }),
        ),
        strokeBorder({
          content: colors.TEXT_MUTED,
          // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- @expo/ui names this parameter `shape`.
          shape: "roundedRectangle",
          cornerRadius: BAR_RADIUS,
          style: { lineWidth: StyleSheet.hairlineWidth },
        }),
      ]
    : [
        glassEffect({
          glass: { variant: "regular" },
          // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- @expo/ui names this parameter `shape`.
          shape: "roundedRectangle",
          cornerRadius: BAR_RADIUS,
        }),
      ];
}

/**
 * What heads a bar inside its glass, such as a composer's held call and
 * queued messages, inset as the row's marks are. Note that it scrolls in
 * place once it would stand taller than a share of the window the keyboard
 * leaves (`HEAD_SHARE`), because at the largest text sizes a held call's
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

  const stack = (
    <VStack
      alignment="leading"
      modifiers={[
        padding(BAR_HEAD_INSET),
        onGeometryChange(({ height }) => setTall(height)),
        ...(scrolls ? [] : fill),
      ]}
    >
      {children}
    </VStack>
  );

  // Note that a head that scrolls takes its ground on the scroll's frame, so the fill stands still while its words scroll over it.
  return scrolls ? (
    <ScrollView modifiers={[frame({ height: most }), ...fill]}>{stack}</ScrollView>
  ) : (
    stack
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
  const measure = useContext(DockMeasure);
  const placed = useRef<HostInstance>(null);

  // Note that it tells where its top stands in the window too, so a failure notice can stand right above it.
  const onLayout =
    measure === undefined
      ? undefined
      : (event: LayoutChangeEvent) => {
          const room = event.nativeEvent.layout.height + SPACE.ROW;
          placed.current?.measureInWindow((_x, top) => measure(room, top));
        };

  // Note that the bottom safe area is let go while the keyboard stands, since the keyboard covers the tab bar it holds room for; the sides are kept, so the bar stops short of a tab rail beside it, as the folded iPhone Duo stands one. The native dock lifts the bar only as far past that safe area as the keyboard stands, so the bar keeps it throughout, and a drag that pulls the keyboard down lowers the bar without a jump at its end.
  return (
    <SafeAreaView
      edges={keyboard && !lifted ? ["left", "right"] : ["bottom", "left", "right"]}
      style={styles.gap}
    >
      <View ref={placed} onLayout={onLayout}>
        {children}
      </View>
    </SafeAreaView>
  );
}

/**
 * A bar of glass holding a composer's field and its buttons, floating over
 * the content it scrolls above, as the system's own bars do. Its children
 * are SwiftUI pieces, laid in a row on a host of its own, under its head
 * where it has one, along the row's foot, so a field grown past one line
 * keeps its buttons beside its last line, as Messages' do. It stands inside
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
  field = false,
}: {
  readonly children: ReactNode;
  /** Whether the row is a field with its presses, which stands on a filled pill inside the glass, as Messages stands its field, so its placeholder and glyphs read over a bright picture scrolling under the bar. */
  readonly field?: boolean;
  /** What stands over the row inside the same glass, such as a composer's queued messages and attached pictures; nothing where none is given. */
  readonly head?: ReactNode;
  /** What the bar's SwiftUI takes over its whole glass, such as a drop of pictures. */
  readonly modifiers?: readonly ModifierConfig[];
}) {
  const solid = useReduceTransparency() || !isLiquidGlassAvailable();
  const ground = useFieldGround(PRESS_SIZE / 2);

  // Note that a solid bar already stands on that fill, so only the glass takes the pill, and its head the same ground.
  const filled = field && !solid;
  const pill = filled ? ground : [];

  const row = (
    <HStack
      alignment="bottom"
      spacing={BAR_ROW_SPACING}
      modifiers={head === undefined ? [...modifiers, ...pill] : [...pill]}
    >
      {children}
    </HStack>
  );

  const content = (
    <Host matchContents={{ vertical: true }} style={styles.content}>
      {head === undefined ? (
        row
      ) : (
        <VStack alignment="leading" spacing={SPACE.TIGHT * 2} modifiers={[...modifiers]}>
          <BarHead filled={filled}>{head}</BarHead>
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

/** Whether the dock follows the keyboard frame by frame, as the native dock does; a list over it may then lower the keyboard under the reader's finger rather than at the first drag. */
export const DOCK_FOLLOWS_KEYBOARD = KeyboardDockArea !== undefined;

/** What a dock holds: the screen's content, and the bar pinned over its foot. */
interface DockProps {
  readonly children: ReactNode;
  readonly bar: ReactNode;
  /** Whether the dock's screen is the one in front, rather than one a page was pushed over, a tab not shown, or a sheet on top: the notice stands over the bar only then. */
  readonly shown: boolean;
}

/**
 * The room the dock's bar takes, as it measures it, and the measure the bar
 * reports to; while the dock's screen is in front, the app's notice stands
 * over the bar, where the bar stands in the window. Note that where the bar
 * stands is kept only as measured with the keyboard down, since the bar
 * rides the keyboard by its height alone, and it counts a tab bar under it,
 * which its height does not.
 */
function useDockLift(keyboard: number, shown: boolean) {
  const [room, setRoom] = useState(DOCK_ROOM_UNMEASURED);
  const [placed, setPlaced] = useState<{ readonly foot: number; readonly room: number }>();
  const { height: windowHeight } = useWindowDimensions();

  const measure = useCallback(
    (next: number, top: number) => {
      setRoom(next);

      if (keyboard === 0) setPlaced({ foot: windowHeight - top + SPACE.ROW, room: next });
    },
    [keyboard, windowHeight],
  );

  // Note that a bar grown or shrunk while the keyboard stood moves its foot by that change alone, since with the keyboard down its bottom stands still, and the keyboard's fall moves the bar without laying it out, so nothing measures it again.
  const foot = placed === undefined ? undefined : placed.foot + room - placed.room;

  useNoticeLift({ room, foot }, shown);

  return { room, measure };
}

/** The bar's column at the dock's foot, at the reading width in a wide window. */
function DockColumn({
  bar,
  onRoom,
}: {
  readonly bar: ReactNode;
  readonly onRoom: (room: number, top: number) => void;
}) {
  // Note that the column holds the window's side safe areas too, which the bar's own safe area view pads inside it, so its glass spans the reading width.
  const { left, right } = useSafeAreaInsets();

  return (
    <View style={[styles.column, { maxWidth: READING_WIDTH + left + right }]}>
      <DockMeasure.Provider value={onRoom}>{bar}</DockMeasure.Provider>
    </View>
  );
}

/**
 * The dock where the app's native dock stands (`keyboard-dock.ts`): it lifts
 * the bar with the keyboard frame by frame, through a drag that pulls the
 * keyboard down, the suggestion strip's growth, and a form sheet's own lift,
 * and tells how far the keyboard stands over its foot, which the content
 * leaves room for. Note that the bar must stand last in it, since the native
 * dock lifts its last child.
 */
function NativeDock({
  area: Area,
  children,
  bar,
  shown,
}: DockProps & { readonly area: NonNullable<typeof KeyboardDockArea> }) {
  const [overlap, setOverlap] = useState(0);
  const { room, measure } = useDockLift(overlap, shown);

  return (
    <Area style={styles.dock} onOverlap={(event) => setOverlap(event.nativeEvent.overlap)}>
      <DockKeyboard.Provider value={overlap}>
        <DockRoom.Provider value={room}>{children}</DockRoom.Provider>
      </DockKeyboard.Provider>
      {/* Note that the docked view is never flattened away, since the native dock lifts its last child, which must be this view and not whatever the bar mounts first. */}
      <View style={styles.docked} collapsable={false}>
        <DockLifted.Provider value={true}>
          <DockColumn bar={bar} onRoom={measure} />
        </DockLifted.Provider>
      </View>
    </Area>
  );
}

/** The dock in a build without the native one: the bar lifted by the keyboard's height as the system announces it, rising and falling on the keyboard's own curve, but standing still through a drag that pulls the keyboard down. */
function AnnouncedDock({ children, bar, shown }: DockProps) {
  // Note that the bar is lifted by the keyboard's own height, read from the system, rather than by a view that pads for it, since the field that raised it stands in SwiftUI.
  const keyboard = useKeyboardHeight();
  const { room, measure } = useDockLift(keyboard, shown);

  return (
    <View style={styles.dock}>
      <DockKeyboard.Provider value={keyboard}>
        <DockRoom.Provider value={room}>{children}</DockRoom.Provider>
      </DockKeyboard.Provider>
      <View style={[styles.docked, { bottom: keyboard }]}>
        <DockColumn bar={bar} onRoom={measure} />
      </View>
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
 * whole window. Where the build carries the native dock, the bar follows the
 * keyboard frame by frame, so a list over it may lower the keyboard under the
 * reader's finger. While its screen is the one in front (`shown`), the app's
 * notice stands over the bar, where the bar stands in the window.
 */
export function GlassDock({ children, bar, shown }: DockProps) {
  return KeyboardDockArea === undefined ? (
    <AnnouncedDock bar={bar} shown={shown}>
      {children}
    </AnnouncedDock>
  ) : (
    <NativeDock area={KeyboardDockArea} bar={bar} shown={shown}>
      {children}
    </NativeDock>
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

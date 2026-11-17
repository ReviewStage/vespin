// composer.tsx -- the rounded glass field at a thread's or a transcript's foot: a + on the left, one act or a menu, the field, and Send or Stop on the right, in a React Native bar or a SwiftUI column's foot.

import {
  Button,
  Divider,
  HStack,
  Image,
  Menu,
  ProgressView,
  TextField,
  type TextFieldSelection,
  Toggle,
  useNativeState,
  VStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityIdentifier,
  accessibilityLabel,
  background,
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  onGeometryChange,
  opacity,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { longPasteIn } from "@repo/features/long-paste";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { COMPOSER_CALL, type ComposerCall, ComposerCallPresses } from "./call.js";
import {
  BAR_EDGE,
  BAR_MARGIN,
  BAR_ROW_SPACING,
  BarHead,
  GlassBar,
  useBarGlass,
} from "./glass-bar.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { actContent } from "./glyph-label.js";
import { dropPictures } from "./interactions.js";
import { useNoticeLift } from "./notice-lift.js";
import { type BarMenu, BarMenuButton } from "./split-view.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The send button's round, in points. */
const SEND_SIZE = 32;

/** How tall a column's composer stands at its foot with its gap before it is measured, a bare field's, which the app's notice stands over, in points. */
const COMPOSER_FOOT_UNMEASURED = SEND_SIZE + 2 * (SPACE.ROW + 2) + SPACE.ROW;

/**
 * A press's frame in the composer's row: Apple's least target, its mark
 * centered in it. The bar's edge is thin (`BAR_EDGE`) by as much as the frame
 * stands past its mark, so the bar draws as it did with its marks alone.
 * Note that a plain mark's button wears it on its label, never on the button,
 * so the whole frame takes the press: a borderless button or a menu answers
 * only where its label is hit. The round button wears it on itself, for its
 * place in the row alone, since its press is its circle's, as the system's is.
 */
const PRESS_FRAME = [
  frame({ minWidth: PRESS_SIZE, minHeight: PRESS_SIZE }),
  SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
];

/** How far the round button's circle stands past the mark inside it, on each axis, in points. */
const ROUND_EDGE = 12;

/** The mark inside the round button, centered in the circle's own size less its edge, so the system's circle draws at Send's size around it. */
function roundMark(round: number) {
  return [frame({ width: round - ROUND_EDGE, height: round - ROUND_EDGE })];
}

/** How much of Send's look stands while there is nothing to send, as Messages' gray arrow stands before a word is typed. */
const IDLE_OPACITY = 0.2;

/** The round button's look: the system's prominent circle in the ink, its mark in the ground, inside the composer's press frame. */
function roundModifiers(colors: ReturnType<typeof useColors>) {
  return [
    buttonStyle("borderedProminent"),
    SwiftModifiers.buttonBorderShape("circle"),
    tint(colors.TEXT),
    foregroundStyle(colors.GROUND),
    ...PRESS_FRAME,
  ];
}

/**
 * Send with nothing to send: the same circle and mark, faint, so it reads as
 * one button waiting in either scheme. Note that we draw the circle
 * ourselves, because a disabled prominent button drops its tint for the
 * system's own fill, which in light vanished into the composer's ground and
 * in dark stood as a black disc that read as a live button.
 */
function idleRoundModifiers(colors: ReturnType<typeof useColors>, round: number) {
  return [
    buttonStyle("plain"),
    foregroundStyle(colors.GROUND),
    frame({ width: round, height: round }),
    background(colors.TEXT, SwiftModifiers.shapes.circle()),
    opacity(IDLE_OPACITY),
    ...PRESS_FRAME,
  ];
}

/** How far the field's words stand from the bar's edge above and below, its own room inside the thin edge. */
const FIELD_INSET = SPACE.TIGHT * 2 - BAR_EDGE;

/** How far the field stands in from the bar's leading edge where no + leads it. */
const FIELD_LEADING = SPACE.ROW + 4 - BAR_EDGE;

/** How far the field's words stand from Send's frame, which stands its round in by less than the row's spacing did. */
const FIELD_TRAILING = SPACE.TIGHT;

/** The most lines the field grows to before it scrolls its words; fewer at an accessibility size, where six of its lines with the keyboard up left the transcript over it no room. */
const FIELD_LINES = { REGULAR: 6, LARGE: 3 } as const;

/** What the + is named by, whether it opens one act or a menu. */
export const ADD_LABEL = "Add";

/**
 * What the + offers where it opens a menu rather than one act, in the
 * menu's order from the +: its acts, such as Photos and Options, then the
 * choices within it, such as Permissions, each a menu of its own with the
 * one on checked, then its switches, such as Fast.
 */
export type ComposerMenu = {
  readonly actions: readonly {
    readonly label: string;
    readonly symbol: Glyph;
    readonly onPress: () => void;
  }[];
  readonly submenus?: readonly BarMenu[] | undefined;
  readonly switches?: BarMenu["choices"] | undefined;
};

type ComposerProps = {
  /** What the field says before anything is typed: "Reply", "Add a note". */
  readonly placeholder: string;
  /** The words in the field, where its holder keeps them, such as a thread's draft that outlives its screen; the field keeps its own where none are given. */
  readonly words?: string | undefined;
  /** Called with the words as they are typed. */
  readonly onWords?: ((words: string) => void) | undefined;
  /** Whether Send stands lit with no words typed, as it does once an ask's answer is picked. */
  readonly sendable?: boolean | undefined;
  /** Called with the words typed once Send is pressed; Send stands disabled where none is given. */
  readonly onSend?: ((words: string) => void) | undefined;
  /** Opens what the + adds, such as a picture; the + is not drawn where neither this nor `addMenu` is given. */
  readonly onAdd?: (() => void) | undefined;
  /** What the + opens as a menu in place of `onAdd`'s one act, such as an agent's Photos, Permissions, and Fast. */
  readonly addMenu?: ComposerMenu | undefined;
  /** What the composer offers of a voice call into its agent: Talk before Send while the field is empty, or the call's presses there while the call stands; none where it calls no one. */
  readonly call?: ComposerCall | undefined;
  /** Stops the turn under way, drawn as Stop in Send's place while the field is empty, as the panel's box offers it while its agent works. */
  readonly onStop?: (() => void) | undefined;
  /** Whether a Stop is out, which stands as the system's spinner in Stop's place until the agent stops. */
  readonly stopping?: boolean | undefined;
  /** What stands over the field inside the same glass: the pictures attached, and what a send that did not go said. */
  readonly head?: ReactNode;
  /** SwiftUI standing over the composer in a glass of its own, as the panel stands an agent's queue over its box: the messages queued behind the turn. */
  readonly above?: ReactNode;
  /** Whether the field takes the keyboard as it stands, as a new comment's field does once opened for its words. */
  readonly autoFocus?: boolean | undefined;
  /** Called with the file addresses of pictures dropped on the composer from Photos, Files, or another app, on an iPad; it takes no drop where none is given. */
  readonly onDropPictures?: ((uris: readonly string[], unreadable: number) => void) | undefined;
  /** Takes words pasted long enough to come as a file (`@repo/features/long-paste`), answering whether it did, so the field takes them back out of its words; they paste as words where none is given. */
  readonly onLongPaste?: ((words: string) => boolean) | undefined;
};

/**
 * The round button at the field's end, the system's own prominent circle as
 * Messages draws Send: Send in the ink once there is something to send and
 * the system's dimmed circle until then, or, while nothing is typed, Stop
 * while a turn runs, and the system's spinner once it is pressed.
 */
function SendButton({
  empty,
  onSend,
  onStop,
  stopping,
}: {
  readonly empty: boolean;
  readonly onSend: (() => void) | undefined;
  readonly onStop: (() => void) | undefined;
  readonly stopping: boolean;
}) {
  const colors = useColors();
  // Note that the circle and its marks grow with the reader's text size, as Messages' Send does, so the field's words never outgrow the button beside them.
  const round = useScaledSize(SEND_SIZE);
  const stopSize = useScaledSize(MARK_SIZE.GLYPH - 2);
  const sendSize = useScaledSize(MARK_SIZE.GLYPH);

  if (empty && onStop !== undefined && stopping) {
    return (
      <ProgressView
        modifiers={[
          frame({ width: round, height: round }),
          ...PRESS_FRAME,
          tint(colors.TEXT_MUTED),
          accessibilityLabel("Stopping"),
        ]}
      />
    );
  }

  if (empty && onStop !== undefined) {
    return (
      <Button onPress={onStop} modifiers={[...roundModifiers(colors), accessibilityLabel("Stop")]}>
        <Image {...glyphImage(GLYPH.STOP_TURN)} size={stopSize} modifiers={roundMark(round)} />
      </Button>
    );
  }

  const sendable = !empty && onSend !== undefined;

  return (
    <Button
      onPress={() => onSend?.()}
      modifiers={[
        ...(sendable ? roundModifiers(colors) : idleRoundModifiers(colors, round)),
        disabled(!sendable),
        accessibilityLabel("Send"),
      ]}
    >
      <Image {...glyphImage(GLYPH.SEND)} size={sendSize} modifiers={roundMark(round)} />
    </Button>
  );
}

/** What the + menu holds, wherever its button stands: its acts, a rule, then its choices within and its switches. */
export function AddMenuItems({ menu }: { readonly menu: ComposerMenu }) {
  const submenus = menu.submenus ?? [];
  const switches = menu.switches ?? [];

  return (
    <>
      {menu.actions.map((action) => (
        <Button
          key={action.label}
          {...actContent(action.label, action.symbol)}
          onPress={action.onPress}
        />
      ))}
      {menu.actions.length === 0 || (submenus.length === 0 && switches.length === 0) ? null : (
        <Divider />
      )}
      {submenus.map((submenu) => (
        <BarMenuButton key={submenu.label} menu={submenu} />
      ))}
      {switches.map((each) => (
        <Toggle
          key={each.label}
          label={each.label}
          isOn={each.on}
          onIsOnChange={() => each.onPress()}
        />
      ))}
    </>
  );
}

/** The + as a menu, as SwiftUI draws one from a press. */
function AddMenu({ menu, testId }: { readonly menu: ComposerMenu; readonly testId: string }) {
  const colors = useColors();
  const addSize = useScaledSize(MARK_SIZE.LEAD + 2);

  return (
    <Menu
      label={
        <Image
          {...glyphImage(GLYPH.ADD)}
          size={addSize}
          color={colors.TEXT_MUTED}
          modifiers={PRESS_FRAME}
        />
      }
      modifiers={[accessibilityLabel(ADD_LABEL), accessibilityIdentifier(testId)]}
    >
      <AddMenuItems menu={menu} />
    </Menu>
  );
}

/** The name a flow finds a composer's + by, where its holder names none. */
const ADD_TEST_ID = "composer-add";

/**
 * The + that leads a bar of glass: a menu of what it adds where it offers
 * more than one thing, else its one act, such as a picture; nothing where it
 * is given neither.
 */
export function AddPress({
  menu,
  onAdd,
  testId = ADD_TEST_ID,
}: {
  readonly menu?: ComposerMenu | undefined;
  readonly onAdd?: (() => void) | undefined;
  /** The name a flow finds the + by. */
  readonly testId?: string | undefined;
}) {
  const colors = useColors();
  const addSize = useScaledSize(MARK_SIZE.LEAD + 2);

  if (menu !== undefined) return <AddMenu menu={menu} testId={testId} />;

  if (onAdd === undefined) return null;

  return (
    <Button
      onPress={onAdd}
      modifiers={[
        buttonStyle("borderless"),
        accessibilityLabel(ADD_LABEL),
        accessibilityIdentifier(testId),
      ]}
    >
      <Image
        {...glyphImage(GLYPH.ADD)}
        size={addSize}
        color={colors.TEXT_MUTED}
        modifiers={PRESS_FRAME}
      />
    </Button>
  );
}

/** The composer's pieces in a row's order: the +, the field, and Send or Stop, which a bar of glass holds. */
function ComposerPieces(props: ComposerProps) {
  const {
    placeholder,
    words: held,
    onWords,
    sendable = false,
    onSend,
    onAdd,
    addMenu,
    call,
    onStop,
    stopping = false,
    onLongPaste,
  } = props;

  const text = useNativeState(held ?? "");
  // Note that a field opening on words handed back, as a refused send's, stands its caret after them, as Messages keeps a draft's, rather than at their start.
  const [opened] = useState(() => (held ?? "").length);
  const caret = useNativeState<TextFieldSelection>({ start: opened, end: opened });
  const [typed, setTyped] = useState(held ?? "");
  const words = held ?? typed;
  // Note that the field is handed the holder's words only where they moved apart from what was typed, as a send empties them or a refusal hands them back.
  const shown = useRef(words);
  useEffect(() => {
    if (held === undefined || held === shown.current) return;
    shown.current = held;
    text.set(held);
  }, [held, text]);

  // Note that a long paste its holder took as a file is taken back out of the words at once, since the field hears no paste of its own, only its words as they change.
  const type = (next: string) => {
    const pasted = onLongPaste === undefined ? undefined : longPasteIn(shown.current, next);
    const taken = pasted !== undefined && onLongPaste?.(pasted.words) === true;
    const typedNow = taken ? pasted.kept : next;
    shown.current = typedNow;

    if (taken) text.set(typedNow);
    setTyped(typedNow);
    onWords?.(typedNow);
  };

  const empty = words.trim() === "" && !sendable;
  const lines = useAccessibilitySize() ? FIELD_LINES.LARGE : FIELD_LINES.REGULAR;

  const send =
    onSend === undefined
      ? undefined
      : () => {
          onSend(words.trim());

          if (held !== undefined) return;
          shown.current = "";
          text.set("");
          setTyped("");
        };

  return (
    <>
      <AddPress menu={addMenu} onAdd={onAdd} />
      <TextField
        text={text}
        placeholder={placeholder}
        axis="vertical"
        autoFocus={props.autoFocus === true}
        {...(opened > 0 && { selection: caret })}
        onTextChange={type}
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_TITLE }),
          lineLimit(lines),
          padding({
            vertical: FIELD_INSET,
            trailing: FIELD_TRAILING,
            ...(addMenu === undefined && onAdd === undefined && { leading: FIELD_LEADING }),
          }),
          // Note that the field with its room stands at least as tall as its buttons' frames, so one line sits level with them in a row laid along its foot, and a longer field grows up from there.
          frame({ minHeight: PRESS_SIZE }),
          accessibilityIdentifier("composer-field"),
        ]}
      />
      {call === undefined || (call.kind === COMPOSER_CALL.TALK && !empty) ? null : (
        <ComposerCallPresses call={call} />
      )}
      <SendButton empty={empty} onSend={send} onStop={onStop} stopping={stopping} />
    </>
  );
}

/**
 * A composer in the system's Liquid Glass at the screen's foot, above the tab
 * bar: the + for what a message carries, the field, which grows with its
 * words, and Send filled with the ink, or Stop while the field is empty and
 * a turn runs. Where its holder keeps the words, the field
 * follows them, so words a refused send hands back stand in it again; else
 * it empties on Send. Pictures dropped on it, on an iPad, go to its
 * holder's `onDropPictures`. It stands in a React Native bar (`GlassBar`),
 * docked over a compact window's screen (`GlassDock`).
 */
export function Composer(props: ComposerProps) {
  const { onDropPictures } = props;

  return (
    <GlassBar
      field
      head={props.head}
      above={props.above}
      modifiers={onDropPictures === undefined ? [] : [dropPictures(onDropPictures)]}
    >
      <ComposerPieces {...props} />
    </GlassBar>
  );
}

/**
 * The same composer at the foot of a SwiftUI column, such as a split view's
 * detail, where no React Native bar can stand: its pieces in a row of the
 * system's own glass, rounded as the bar is, or solid where the reader
 * reduces transparency, as the bar stands (`useBarGlass`), taking pictures
 * dropped on it as the bar does. While its column is the one in front
 * (`shown`), the app's notice stands over it, as tall as it stands, its head
 * of queued messages or a held call included.
 */
export function ComposerFoot(props: ComposerProps & { readonly shown: boolean }) {
  const { onDropPictures } = props;
  const [room, setRoom] = useState(COMPOSER_FOOT_UNMEASURED);
  useNoticeLift({ room }, props.shown);

  const measured = onGeometryChange(({ height }) => setRoom(height + SPACE.ROW));

  const glass = [
    padding({ all: BAR_EDGE }),
    ...useBarGlass(),
    padding({ horizontal: BAR_MARGIN, bottom: SPACE.ROW }),
    ...(onDropPictures === undefined ? [] : [dropPictures(onDropPictures)]),
  ];

  const foot =
    props.head === undefined ? (
      <HStack alignment="bottom" spacing={BAR_ROW_SPACING} modifiers={glass}>
        <ComposerPieces {...props} />
      </HStack>
    ) : (
      <VStack alignment="leading" spacing={SPACE.TIGHT * 2} modifiers={glass}>
        <BarHead>{props.head}</BarHead>
        <HStack alignment="bottom" spacing={BAR_ROW_SPACING}>
          <ComposerPieces {...props} />
        </HStack>
      </VStack>
    );

  // Note that what stands over the composer is measured with it, so the notice stands over both, and the composer keeps its place under it whether or not anything stands there, so its field is never drawn anew as the queue comes and goes.
  return (
    <VStack spacing={SPACE.TIGHT * 2} modifiers={[measured]}>
      {props.above === undefined ? null : (
        <VStack modifiers={[padding({ horizontal: BAR_MARGIN })]}>{props.above}</VStack>
      )}
      {foot}
    </VStack>
  );
}

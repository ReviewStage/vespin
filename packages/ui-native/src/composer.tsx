// composer.tsx -- the rounded glass field at a thread's or a transcript's foot: a + on the left, one act or a menu, the field, and a send or mic button on the right, in a React Native bar or a SwiftUI column's foot.

import {
  Button,
  Divider,
  HStack,
  Image,
  Menu,
  ProgressView,
  TextField,
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
  glassEffect,
  lineLimit,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { BAR_EDGE, BAR_RADIUS, BAR_ROW_SPACING, BarHead, GlassBar } from "./glass-bar.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { actContent } from "./glyph-label.js";
import { dropPictures } from "./interactions.js";
import { type BarMenu, BarMenuButton } from "./split-view.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The send button's round, in points. */
const SEND_SIZE = 32;

/**
 * A press's frame in the composer's row: Apple's least target, its mark
 * centered in it, the whole frame taking the press. The bar's edge is thin
 * (`BAR_EDGE`) by as much as the frame stands past its mark, so the bar
 * draws as it did with its marks alone.
 */
const PRESS_FRAME = [
  frame({ minWidth: PRESS_SIZE, minHeight: PRESS_SIZE }),
  SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
];

/** The mark inside the round button, centered in the circle's own size, so the system's circle draws at Send's size around it. */
const ROUND_MARK = [frame({ width: SEND_SIZE - 12, height: SEND_SIZE - 12 })];

/**
 * The round button's look: the system's prominent circle in the ink, its mark
 * in the ground, inside the composer's press frame. Note that a disabled
 * circle drops the tint for the system's faint fill, which in light mode
 * matched the composer's own ground, so a Send with nothing to send vanished:
 * it stands on a hairline-gray disc of ours instead, its mark muted.
 */
function roundModifiers(colors: ReturnType<typeof useColors>, enabled = true) {
  return [
    buttonStyle("borderedProminent"),
    SwiftModifiers.buttonBorderShape("circle"),
    tint(colors.TEXT),
    foregroundStyle(enabled ? colors.GROUND : colors.TEXT_MUTED),
    ...(enabled ? [] : [background(colors.CHIP_EDGE, SwiftModifiers.shapes.circle())]),
    ...PRESS_FRAME,
  ];
}

/** How far the field's words stand from the bar's edge above and below, its own room inside the thin edge. */
const FIELD_INSET = SPACE.TIGHT * 2 - BAR_EDGE;

/** How far the field stands in from the bar's leading edge where no + leads it. */
const FIELD_LEADING = SPACE.ROW + 4 - BAR_EDGE;

/** How far the field's words stand from Send's frame, which stands its round in by less than the row's spacing did. */
const FIELD_TRAILING = SPACE.TIGHT;

/** The most lines the field grows to before it scrolls its words. */
const FIELD_LINES = 6;

/** What the + is named by, whether it opens one act or a menu. */
const ADD_LABEL = "Add";

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
  /** Starts dictation, drawn as a mic in Send's place while the field is empty. */
  readonly onDictate?: (() => void) | undefined;
  /** Stops the turn under way, drawn as Stop in Send's place while the field is empty, as the panel's box offers it while its agent works. */
  readonly onStop?: (() => void) | undefined;
  /** Whether a Stop is out, which stands as the system's spinner in Stop's place until the agent stops. */
  readonly stopping?: boolean | undefined;
  /** What stands over the field inside the same glass: the messages queued behind the turn, the pictures attached, and what a send that did not go said. */
  readonly head?: ReactNode;
  /** Whether the field takes the keyboard as it stands, as a new comment's field does once opened for its words. */
  readonly autoFocus?: boolean | undefined;
  /** Called with the file addresses of pictures dropped on the composer from Photos, Files, or another app, on an iPad; it takes no drop where none is given. */
  readonly onDropPictures?: ((uris: readonly string[], unreadable: number) => void) | undefined;
};

/**
 * The round button at the field's end, the system's own prominent circle as
 * Messages draws Send: Send in the ink once there is something to send and
 * the system's dimmed circle until then, or, while nothing is typed, Stop
 * while a turn runs, the system's spinner once it is pressed, else the mic.
 */
function SendButton({
  empty,
  onSend,
  onDictate,
  onStop,
  stopping,
}: {
  readonly empty: boolean;
  readonly onSend: (() => void) | undefined;
  readonly onDictate: (() => void) | undefined;
  readonly onStop: (() => void) | undefined;
  readonly stopping: boolean;
}) {
  const colors = useColors();

  if (empty && onStop !== undefined && stopping) {
    return (
      <ProgressView
        modifiers={[
          frame({ width: SEND_SIZE, height: SEND_SIZE }),
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
        <Image {...glyphImage(GLYPH.STOP_TURN)} size={MARK_SIZE.GLYPH - 2} modifiers={ROUND_MARK} />
      </Button>
    );
  }

  if (empty && onDictate !== undefined) {
    return (
      <Button
        onPress={onDictate}
        modifiers={[buttonStyle("borderless"), ...PRESS_FRAME, accessibilityLabel("Dictate")]}
      >
        <Image {...glyphImage(GLYPH.DICTATE)} size={MARK_SIZE.LEAD + 2} color={colors.TEXT_MUTED} />
      </Button>
    );
  }

  const sendable = !empty && onSend !== undefined;

  return (
    <Button
      onPress={() => onSend?.()}
      modifiers={[
        ...roundModifiers(colors, sendable),
        disabled(!sendable),
        accessibilityLabel("Send"),
      ]}
    >
      <Image {...glyphImage(GLYPH.SEND)} size={MARK_SIZE.GLYPH} modifiers={ROUND_MARK} />
    </Button>
  );
}

/** The + as a menu, as SwiftUI draws one from a press: its acts, a rule, then its choices within and its switches. */
function AddMenu({ menu, testId }: { readonly menu: ComposerMenu; readonly testId: string }) {
  const colors = useColors();
  const submenus = menu.submenus ?? [];
  const switches = menu.switches ?? [];

  return (
    <Menu
      label={
        <Image {...glyphImage(GLYPH.ADD)} size={MARK_SIZE.LEAD + 2} color={colors.TEXT_MUTED} />
      }
      modifiers={[...PRESS_FRAME, accessibilityLabel(ADD_LABEL), accessibilityIdentifier(testId)]}
    >
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

  if (menu !== undefined) return <AddMenu menu={menu} testId={testId} />;

  if (onAdd === undefined) return null;

  return (
    <Button
      onPress={onAdd}
      modifiers={[
        buttonStyle("borderless"),
        ...PRESS_FRAME,
        accessibilityLabel(ADD_LABEL),
        accessibilityIdentifier(testId),
      ]}
    >
      <Image {...glyphImage(GLYPH.ADD)} size={MARK_SIZE.LEAD + 2} color={colors.TEXT_MUTED} />
    </Button>
  );
}

/** The composer's pieces in a row's order: the +, the field, and Send or the mic, which a bar of glass holds. */
function ComposerPieces(props: ComposerProps) {
  const {
    placeholder,
    words: held,
    onWords,
    sendable = false,
    onSend,
    onAdd,
    addMenu,
    onDictate,
    onStop,
    stopping = false,
  } = props;

  const text = useNativeState(held ?? "");
  const [typed, setTyped] = useState(held ?? "");
  const words = held ?? typed;
  // Note that the field is handed the holder's words only where they moved apart from what was typed, as a send empties them or a refusal hands them back.
  const shown = useRef(words);
  useEffect(() => {
    if (held === undefined || held === shown.current) return;
    shown.current = held;
    text.set(held);
  }, [held, text]);

  const type = (next: string) => {
    shown.current = next;
    setTyped(next);
    onWords?.(next);
  };

  const empty = words.trim() === "" && !sendable;

  const send =
    onSend === undefined
      ? undefined
      : () => {
          onSend(words.trim());

          if (held !== undefined) return;
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
        onTextChange={type}
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_TITLE }),
          lineLimit(FIELD_LINES),
          padding({
            vertical: FIELD_INSET,
            trailing: FIELD_TRAILING,
            ...(addMenu === undefined && onAdd === undefined && { leading: FIELD_LEADING }),
          }),
          accessibilityIdentifier("composer-field"),
        ]}
      />
      <SendButton
        empty={empty}
        onSend={send}
        onDictate={onDictate}
        onStop={onStop}
        stopping={stopping}
      />
    </>
  );
}

/**
 * A composer in the system's Liquid Glass at the screen's foot, above the tab
 * bar: the + for what a message carries, the field, which grows with its
 * words, and Send filled with the ink, or the mic while the field is empty
 * where dictation is offered. Where its holder keeps the words, the field
 * follows them, so words a refused send hands back stand in it again; else
 * it empties on Send. Pictures dropped on it, on an iPad, go to its
 * holder's `onDropPictures`. It stands in a React Native bar (`GlassBar`),
 * docked over a compact window's screen (`GlassDock`).
 */
export function Composer(props: ComposerProps) {
  const { onDropPictures } = props;

  return (
    <GlassBar
      head={props.head}
      modifiers={onDropPictures === undefined ? [] : [dropPictures(onDropPictures)]}
    >
      <ComposerPieces {...props} />
    </GlassBar>
  );
}

/**
 * The same composer at the foot of a SwiftUI column, such as a split view's
 * detail, where no React Native bar can stand: its pieces in a row of the
 * system's own glass, rounded as the bar is.
 */
export function ComposerFoot(props: ComposerProps) {
  const glass = [
    padding({ all: BAR_EDGE }),
    glassEffect({
      glass: { variant: "regular" },
      // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- @expo/ui names this parameter `shape`.
      shape: "roundedRectangle",
      cornerRadius: BAR_RADIUS,
    }),
    padding({ horizontal: SPACE.ROW + 2, bottom: SPACE.ROW }),
  ];

  if (props.head === undefined) {
    return (
      <HStack spacing={BAR_ROW_SPACING} modifiers={glass}>
        <ComposerPieces {...props} />
      </HStack>
    );
  }

  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT * 2} modifiers={glass}>
      <BarHead>{props.head}</BarHead>
      <HStack spacing={BAR_ROW_SPACING}>
        <ComposerPieces {...props} />
      </HStack>
    </VStack>
  );
}

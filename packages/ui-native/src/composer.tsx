// composer.tsx -- the rounded glass field at a thread's or a transcript's foot: a + on the left, the field, and a send or mic button on the right, in a React Native bar or a SwiftUI column's foot.

import {
  Button,
  HStack,
  Image,
  ProgressView,
  TextField,
  useNativeState,
  VStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityIdentifier,
  accessibilityLabel,
  background,
  buttonStyle,
  disabled,
  font,
  frame,
  glassEffect,
  lineLimit,
  padding,
  shapes,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { BAR_RADIUS, GlassBar } from "./glass-bar.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The send button's round, in points. */
const SEND_SIZE = 32;

/** The most lines the field grows to before it scrolls its words. */
const FIELD_LINES = 6;

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
  /** Opens what the + adds, such as a picture; the + is not drawn where none is given. */
  readonly onAdd?: (() => void) | undefined;
  /** Starts dictation, drawn as a mic in Send's place while the field is empty. */
  readonly onDictate?: (() => void) | undefined;
  /** Stops the turn under way, drawn as Stop in Send's place while the field is empty, as the panel's box offers it while its agent works. */
  readonly onStop?: (() => void) | undefined;
  /** Whether a Stop is out, which stands as the system's spinner in Stop's place until the agent stops. */
  readonly stopping?: boolean | undefined;
  /** What stands over the field inside the same glass: the messages queued behind the turn, the pictures attached, and what a send that did not go said. */
  readonly head?: ReactNode;
};

/** The round button at the field's end: Send, filled with the ink once there is something to send and a faint well until then, or, while nothing is typed, Stop while a turn runs, the system's spinner once it is pressed, else the mic. */
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
          tint(colors.TEXT_MUTED),
          accessibilityLabel("Stopping"),
        ]}
      />
    );
  }
  if (empty && onStop !== undefined) {
    return (
      <Button onPress={onStop} modifiers={[buttonStyle("plain"), accessibilityLabel("Stop")]}>
        <Image
          systemName="stop.fill"
          size={MARK_SIZE.GLYPH - 2}
          color={colors.GROUND}
          modifiers={[
            frame({ width: SEND_SIZE, height: SEND_SIZE }),
            background(colors.TEXT, shapes.circle()),
          ]}
        />
      </Button>
    );
  }
  if (empty && onDictate !== undefined) {
    return (
      <Button onPress={onDictate} modifiers={[buttonStyle("plain"), accessibilityLabel("Dictate")]}>
        <Image systemName="mic" size={MARK_SIZE.LEAD + 2} color={colors.TEXT_MUTED} />
      </Button>
    );
  }
  return (
    <Button
      onPress={() => onSend?.()}
      modifiers={[
        buttonStyle("plain"),
        disabled(empty || onSend === undefined),
        accessibilityLabel("Send"),
      ]}
    >
      <Image
        systemName="arrow.up"
        size={MARK_SIZE.GLYPH + 2}
        color={empty ? colors.TEXT_MUTED : colors.GROUND}
        modifiers={[
          frame({ width: SEND_SIZE, height: SEND_SIZE }),
          background(empty ? colors.CHIP_EDGE : colors.TEXT, shapes.circle()),
        ]}
      />
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
    onDictate,
    onStop,
    stopping = false,
  } = props;
  const colors = useColors();
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
      {onAdd === undefined ? null : (
        <Button onPress={onAdd} modifiers={[buttonStyle("plain"), accessibilityLabel("Add")]}>
          <Image systemName="plus" size={MARK_SIZE.LEAD + 2} color={colors.TEXT_MUTED} />
        </Button>
      )}
      <TextField
        text={text}
        placeholder={placeholder}
        axis="vertical"
        onTextChange={type}
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_TITLE }),
          lineLimit(FIELD_LINES),
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
 * it empties on Send. It stands in a React Native bar (`GlassBar`), docked
 * over a compact window's screen (`GlassDock`).
 */
export function Composer(props: ComposerProps) {
  return (
    <GlassBar head={props.head}>
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
    padding({ leading: SPACE.ROW + 4, trailing: SPACE.TIGHT * 2, vertical: SPACE.TIGHT * 2 }),
    glassEffect({
      glass: { variant: "regular", interactive: true },
      shape: "roundedRectangle",
      cornerRadius: BAR_RADIUS,
    }),
    padding({ horizontal: SPACE.ROW + 2, bottom: SPACE.ROW }),
  ];
  if (props.head === undefined) {
    return (
      <HStack spacing={SPACE.ROW} modifiers={glass}>
        <ComposerPieces {...props} />
      </HStack>
    );
  }
  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT * 2} modifiers={glass}>
      {props.head}
      <HStack spacing={SPACE.ROW}>
        <ComposerPieces {...props} />
      </HStack>
    </VStack>
  );
}

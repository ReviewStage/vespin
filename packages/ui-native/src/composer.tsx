// composer.tsx -- the rounded glass field at a thread's or a transcript's foot: a + on the left, the field, and a send or mic button on the right.

import { Button, Image, TextField, useNativeState } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  background,
  buttonStyle,
  disabled,
  font,
  frame,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { useState } from "react";
import { GlassBar } from "./glass-bar.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The send button's round, in points. */
const SEND_SIZE = 32;

type ComposerProps = {
  /** What the field says before anything is typed: "Reply…", "Message agent…". */
  readonly placeholder: string;
  /** Called with the words typed once Send is pressed; Send stands disabled where none is given. */
  readonly onSend?: ((words: string) => void) | undefined;
  /** Opens what the + adds, such as a picture; the + is not drawn where none is given. */
  readonly onAdd?: (() => void) | undefined;
  /** Starts dictation, drawn as a mic in Send's place while the field is empty. */
  readonly onDictate?: (() => void) | undefined;
};

/** The round button at the field's end: Send, filled with the ink, or the mic while nothing is typed. */
function SendButton({
  empty,
  onSend,
  onDictate,
}: {
  readonly empty: boolean;
  readonly onSend: (() => void) | undefined;
  readonly onDictate: (() => void) | undefined;
}) {
  const colors = useColors();
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
        color={colors.GROUND}
        modifiers={[
          frame({ width: SEND_SIZE, height: SEND_SIZE }),
          background(empty ? colors.TEXT_MUTED : colors.TEXT, shapes.circle()),
        ]}
      />
    </Button>
  );
}

/**
 * A composer in the system's Liquid Glass at the screen's foot, above the tab
 * bar: the + for what a message carries, the field, which grows with its
 * words, and Send filled with the ink, or the mic while the field is empty
 * where dictation is offered. It is drawn here alone; the screens wire
 * sending as they take it up.
 */
export function Composer({ placeholder, onSend, onAdd, onDictate }: ComposerProps) {
  const colors = useColors();
  const text = useNativeState("");
  const [words, setWords] = useState("");
  const send =
    onSend === undefined
      ? undefined
      : () => {
          onSend(words.trim());
          text.set("");
          setWords("");
        };
  return (
    <GlassBar>
      {onAdd === undefined ? null : (
        <Button onPress={onAdd} modifiers={[buttonStyle("plain"), accessibilityLabel("Add")]}>
          <Image systemName="plus" size={MARK_SIZE.LEAD + 2} color={colors.TEXT_MUTED} />
        </Button>
      )}
      <TextField
        text={text}
        placeholder={placeholder}
        axis="vertical"
        onTextChange={setWords}
        modifiers={[font({ textStyle: TYPE_ROLE.ROW_TITLE })]}
      />
      <SendButton empty={words.trim() === ""} onSend={send} onDictate={onDictate} />
    </GlassBar>
  );
}

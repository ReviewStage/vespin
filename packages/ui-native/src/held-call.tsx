// held-call.tsx -- a tool call the agent holds for the reader's answer: where it stands and Deny and Allow under its line in the transcript, the line over the composer saying a message denies it, and a banner there for a call no row draws.

import { HStack, Image, Button as SwiftUIButton, Text, VStack } from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityHidden,
  accessibilityHint,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
} from "@expo/ui/swift-ui/modifiers";
import { APPROVAL_PRESS_WORDS, DENIES_WAITING } from "@repo/features/agent-approval-model";
import { APPROVAL_ANSWER } from "@repo/features/agent-approval-wire";
import { useAccessibilitySize } from "./accessibility.js";
import { AskNote } from "./ask-card.js";
import { BUTTON_LOOK, Button } from "./button.js";
import { GLYPH, glyphImage } from "./glyph.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The answers the phone offers a held call: Allow and Deny, as the panel's card offers them first. */
export const HELD_ANSWER = {
  ALLOW: APPROVAL_ANSWER.ALLOW,
  DENY: APPROVAL_ANSWER.DENY,
} as const;

export type HeldAnswer = (typeof HELD_ANSWER)[keyof typeof HELD_ANSWER];

/** A held call as its row draws it. */
export type HeldCall = {
  /** Where it stands in words: that it waits, then how it came out. */
  readonly words: string;
  /** Whether it still waits on an answer, so the presses stand under it. */
  readonly waiting: boolean;
  /** Who asks and why, where the CLI said more than the call's own line. */
  readonly about: string | undefined;
  /** The answer on its way, whose press reads busy while the others take nothing. */
  readonly answering: HeldAnswer | undefined;
  /** Why the last answer did not go. */
  readonly note: string | undefined;
  readonly onAnswer: (answer: HeldAnswer) => void;
};

/**
 * Deny and Allow side by side, Allow filled as the act a held call is for;
 * the press out reads busy, and neither takes a press meanwhile. Note that
 * at an accessibility size they stack, as an alert's buttons do, because
 * side by side under a call's indented line at AX5 Deny broke into "Den"
 * and "y".
 */
function ApprovalPresses({ answering, onAnswer }: Pick<HeldCall, "answering" | "onAnswer">) {
  const large = useAccessibilitySize();
  const out = answering !== undefined;

  const deny =
    answering === HELD_ANSWER.DENY ? APPROVAL_PRESS_WORDS.DENYING : APPROVAL_PRESS_WORDS.DENY;

  const allow =
    answering === HELD_ANSWER.ALLOW ? APPROVAL_PRESS_WORDS.ALLOWING : APPROVAL_PRESS_WORDS.ALLOW;

  // Note that each button is keyed by its words, so a busy press is drawn anew rather than left saying what it first said.
  const presses = (
    <>
      <Button
        key={deny}
        label={deny}
        look={BUTTON_LOOK.BORDERED}
        disabled={out}
        onPress={() => onAnswer(HELD_ANSWER.DENY)}
      />
      <Button
        key={allow}
        label={allow}
        disabled={out}
        onPress={() => onAnswer(HELD_ANSWER.ALLOW)}
      />
    </>
  );

  return large ? (
    <VStack alignment="leading" spacing={SPACE.TIGHT * 2}>
      {presses}
    </VStack>
  ) : (
    <HStack spacing={SPACE.ROW}>{presses}</HStack>
  );
}

/**
 * Under a held call's line in the transcript: where it stands, in the
 * attention ink while it waits and muted once it came out, who asks and
 * why, why an answer did not go, and Deny and Allow while it waits.
 */
export function HeldCallBody({ held }: { readonly held: HeldCall }) {
  const colors = useColors();

  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT * 2}>
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "medium" }),
          foregroundStyle(colors.TEXT_MUTED),
        ]}
      >
        {held.words}
      </Text>
      {held.about === undefined ? null : (
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
        >
          {held.about}
        </Text>
      )}
      {held.note === undefined ? null : <AskNote words={held.note} />}
      {held.waiting ? (
        <ApprovalPresses answering={held.answering} onAnswer={held.onAnswer} />
      ) : null}
    </VStack>
  );
}

/** What a press on the denial line is heard to do. */
const SHOW_WAITING_HINT = "Shows the call waiting in the transcript";

/**
 * Over the composer's field while a call waits and a message sent now would
 * deny it, as the panel's composer says it: "Sending a message denies the
 * waiting approval." in the muted ink. A press scrolls the transcript to the
 * call's row, whose Deny and Allow answer it; where no row is drawn it is
 * words alone.
 */
export function DeniesWaiting({ onShow }: { readonly onShow?: (() => void) | undefined }) {
  const colors = useColors();

  const words = (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_LINE }),
        foregroundStyle(colors.TEXT_MUTED),
        frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
      ]}
    >
      {DENIES_WAITING}
    </Text>
  );

  if (onShow === undefined) return words;

  return (
    <SwiftUIButton
      onPress={onShow}
      modifiers={[
        buttonStyle("plain"),
        SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
        accessibilityHint(SHOW_WAITING_HINT),
      ]}
    >
      {words}
    </SwiftUIButton>
  );
}

type HeldCallBannerProps = Pick<HeldCall, "answering" | "note" | "onAnswer"> & {
  /** How many calls wait, as the panel's working line says it: "Waiting on you · 1 approval". */
  readonly waiting: string;
  /** What the oldest call waiting asks, as the agent's CLI put it. */
  readonly asks: string;
};

/**
 * What stands over the composer's field, inside its glass, while a call
 * waits that no row of the transcript draws, such as a subagent's, so it is
 * still answered: a raised hand and how many wait in the attention ink,
 * what the oldest asks, and Deny and Allow. A call whose row is drawn is
 * answered there alone, as on the panel. The page tells VoiceOver of every
 * call waiting from its composer, which stands while this comes and goes.
 */
export function HeldCallBanner({ waiting, asks, answering, note, onAnswer }: HeldCallBannerProps) {
  const colors = useColors();
  const large = useAccessibilitySize();

  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT * 2}>
      <HStack spacing={SPACE.ROW}>
        <Image
          {...glyphImage(GLYPH.ASK_FIRST)}
          size={MARK_SIZE.GLYPH}
          color={colors.ATTENTION}
          modifiers={[accessibilityHidden()]}
        />
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "medium" }),
            foregroundStyle(colors.ATTENTION),
            frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
          ]}
        >
          {waiting}
        </Text>
      </HStack>
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_TITLE }),
          foregroundStyle(colors.TEXT_BODY),
          // Note that what is asked is read whole at an accessibility size, since a reader approves what they can read.
          lineLimit(large ? 8 : 2),
        ]}
      >
        {asks}
      </Text>
      {note === undefined ? null : <AskNote words={note} />}
      <ApprovalPresses answering={answering} onAnswer={onAnswer} />
    </VStack>
  );
}

// held-call.tsx -- a tool call the agent holds for the reader's answer: where it stands and Deny, Always allow and Allow under its line in the transcript, and a banner over the composer for a call no row draws.

import { HStack, Image, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
  font,
  foregroundStyle,
  frame,
  lineLimit,
} from "@expo/ui/swift-ui/modifiers";
import {
  ALWAYS_ALLOW_COMMAND_WORDS,
  APPROVAL_PRESS_WORDS,
} from "@repo/features/agent-approval-model";
import { APPROVAL_ANSWER } from "@repo/features/agent-approval-wire";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { AskNote } from "./ask-card.js";
import { BUTTON_LOOK, Button } from "./button.js";
import { GLYPH, glyphImage } from "./glyph.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** The answers the phone offers a held call, as the panel's card offers them: Allow, Always allow for the agent, and Deny. */
export const HELD_ANSWER = {
  ALLOW: APPROVAL_ANSWER.ALLOW,
  ALLOW_FOR_AGENT: APPROVAL_ANSWER.ALLOW_FOR_AGENT,
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
  /** The command Always allow keeps for every agent of the member's, as it reads (`pnpm test *`); none where it lasts for this agent alone. */
  readonly command: string | undefined;
  readonly onAnswer: (answer: HeldAnswer) => void;
};

/**
 * Deny, Always allow and Allow side by side, Allow filled last as the act a
 * held call is for, Always allow bordered beside it as the panel's outlines
 * it; the press out reads busy, and none takes a press meanwhile. Where
 * Always allow keeps a command for every agent, a muted line under them
 * names it, as the panel's says it. Note that at an accessibility size they
 * stack, as an alert's buttons do, because side by side under a call's
 * indented line at AX5 Deny broke into "Den" and "y".
 */
function ApprovalPresses({
  answering,
  command,
  onAnswer,
}: Pick<HeldCall, "answering" | "command" | "onAnswer">) {
  const large = useAccessibilitySize();
  const colors = useColors();
  const out = answering !== undefined;

  const deny =
    answering === HELD_ANSWER.DENY ? APPROVAL_PRESS_WORDS.DENYING : APPROVAL_PRESS_WORDS.DENY;

  const always =
    answering === HELD_ANSWER.ALLOW_FOR_AGENT
      ? APPROVAL_PRESS_WORDS.ALLOWING
      : APPROVAL_PRESS_WORDS.ALLOW_FOR_AGENT;

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
        key={always}
        label={always}
        look={BUTTON_LOOK.BORDERED}
        disabled={out}
        onPress={() => onAnswer(HELD_ANSWER.ALLOW_FOR_AGENT)}
      />
      <Button
        key={allow}
        label={allow}
        disabled={out}
        onPress={() => onAnswer(HELD_ANSWER.ALLOW)}
      />
    </>
  );

  const row = large ? (
    <VStack alignment="leading" spacing={SPACE.TIGHT * 2}>
      {presses}
    </VStack>
  ) : (
    <HStack spacing={SPACE.ROW}>{presses}</HStack>
  );

  if (command === undefined) return row;

  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT * 2}>
      {row}
      <Text
        modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
      >
        <Text>{ALWAYS_ALLOW_COMMAND_WORDS.BEFORE}</Text>
        <Text modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE, design: "monospaced" })]}>
          {command}
        </Text>
        <Text>{ALWAYS_ALLOW_COMMAND_WORDS.AFTER}</Text>
      </Text>
    </VStack>
  );
}

/**
 * Under a held call's line in the transcript: where it stands, in the
 * attention ink while it waits and muted once it came out, who asks and
 * why, why an answer did not go, and Deny, Always allow and Allow while it
 * waits.
 */
export function HeldCallBody({ held }: { readonly held: HeldCall }) {
  const colors = useColors();

  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT * 2}>
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "medium" }),
          foregroundStyle(held.waiting ? colors.ATTENTION : colors.TEXT_MUTED),
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
        <ApprovalPresses
          answering={held.answering}
          command={held.command}
          onAnswer={held.onAnswer}
        />
      ) : null}
    </VStack>
  );
}

type HeldCallBannerProps = Pick<HeldCall, "answering" | "note" | "command" | "onAnswer"> & {
  /** How many calls wait, as the panel's working line says it: "Waiting on you · 1 approval". */
  readonly waiting: string;
  /** What the oldest call waiting asks, as the agent's CLI put it. */
  readonly asks: string;
};

/**
 * What stands in the composer's head, over its field, while a call waits
 * that no row of the transcript draws, such as a subagent's, so it is still
 * answered, as the panel stands such a call in its conversation, folded
 * away and back by the composer's Approval capsule: a raised hand and how many wait in the attention ink,
 * what the oldest asks, and Deny, Always allow and Allow. A call whose row is drawn is
 * answered there alone, as on the panel. The page tells VoiceOver of every
 * call waiting from its composer, which stands while this comes and goes.
 */
export function HeldCallBanner({
  waiting,
  asks,
  answering,
  note,
  command,
  onAnswer,
}: HeldCallBannerProps) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const hand = useScaledSize(MARK_SIZE.GLYPH);

  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT * 2}>
      <HStack spacing={SPACE.ROW}>
        <Image
          {...glyphImage(GLYPH.ASK_FIRST)}
          size={hand}
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
      <ApprovalPresses answering={answering} command={command} onAnswer={onAnswer} />
    </VStack>
  );
}

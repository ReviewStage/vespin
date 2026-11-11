// held-call.tsx -- a tool call the agent holds for the reader's answer: where it stands and Deny and Allow under its line in the transcript, and a banner over the composer while any call waits.

import { HStack, Image, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
  font,
  foregroundStyle,
  frame,
  lineLimit,
} from "@expo/ui/swift-ui/modifiers";
import { APPROVAL_PRESS_WORDS } from "@repo/features/agent-approval-model";
import { APPROVAL_ANSWER } from "@repo/features/agent-approval-wire";
import { useAccessibilitySize, useAnnounced } from "./accessibility.js";
import { AskNote } from "./ask-card.js";
import { BUTTON_LOOK, Button } from "./button.js";
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

/** Deny and Allow side by side, Allow filled as the act a held call is for; the press out reads busy, and neither takes a press meanwhile. */
function ApprovalPresses({ answering, onAnswer }: Pick<HeldCall, "answering" | "onAnswer">) {
  const out = answering !== undefined;
  const deny =
    answering === HELD_ANSWER.DENY ? APPROVAL_PRESS_WORDS.DENYING : APPROVAL_PRESS_WORDS.DENY;
  const allow =
    answering === HELD_ANSWER.ALLOW ? APPROVAL_PRESS_WORDS.ALLOWING : APPROVAL_PRESS_WORDS.ALLOW;
  // Note that each button is keyed by its words, so a busy press is drawn anew rather than left saying what it first said.
  return (
    <HStack spacing={SPACE.ROW}>
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
    </HStack>
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

type HeldCallBannerProps = Pick<HeldCall, "answering" | "note" | "onAnswer"> & {
  /** How many calls wait, as the panel's working line says it: "Waiting on you · 1 approval". */
  readonly waiting: string;
  /** What the oldest call waiting asks, as the agent's CLI put it. */
  readonly asks: string;
  /** That a message sent now denies the calls waiting, said under what is asked; none where Send would queue it instead. */
  readonly denies?: string | undefined;
};

/**
 * What stands over the composer's field, inside its glass, while a call
 * waits, so a held agent is never missed however far the transcript has
 * scrolled: a raised hand and how many wait in the attention ink, what the
 * oldest asks, that a message sent now denies it where one would, and Deny
 * and Allow, which answer it.
 */
export function HeldCallBanner({
  waiting,
  asks,
  denies,
  answering,
  note,
  onAnswer,
}: HeldCallBannerProps) {
  const colors = useColors();
  const large = useAccessibilitySize();
  // Note that the banner is told to VoiceOver as it stands, since an agent held for an answer waits on the reader wherever they are.
  useAnnounced(`${waiting}, ${asks}`, true);
  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT * 2}>
      <HStack spacing={SPACE.ROW}>
        <Image
          systemName="hand.raised"
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
      {denies === undefined ? null : (
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
        >
          {denies}
        </Text>
      )}
      {note === undefined ? null : <AskNote words={note} />}
      <ApprovalPresses answering={answering} onAnswer={onAnswer} />
    </VStack>
  );
}

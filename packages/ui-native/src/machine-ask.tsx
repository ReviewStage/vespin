// machine-ask.tsx -- an ask one of the developer's machines holds for an agent, over that agent's composer on the phone: which machine asks and the time it has left, what it would run or use, and Deny, Just this once and Always allow.

import { HStack, Image, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityHidden,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
} from "@expo/ui/swift-ui/modifiers";
import { MACHINE_ASK_DECISION, type MachineAskDecision } from "@repo/features/machine-ask-wire";
import { timeLeftText } from "@repo/features/time-format";
import { useEffect, useState } from "react";
import { useAccessibilitySize } from "./accessibility.js";
import { AskNote } from "./ask-card.js";
import { BUTTON_LOOK, Button } from "./button.js";
import { GLYPH, glyphImage } from "./glyph.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What the banner says, in the panel's words for the same ask. */
const MACHINE_ASK_WORDS = {
  SHELL: "Run a command",
  app: (app: string) => `Use ${app}`,
  asks: (machine: string) => `${machine} asks`,
  left: (left: string) => `${left} left`,
  TIMED_OUT: "Timed out",
  DENY: "Deny",
  ONCE: "Just this once",
  ALWAYS: "Always allow",
} as const;

/** How often the time left is drawn again: each second, as the panel's countdown ticks. */
const TICK_MS = 1000;

/** What one machine's ask asks: a command to run, or an app to use. */
export type MachineAskSubjectLine = { readonly command: string } | { readonly app: string };

type MachineAskBannerProps = {
  /** The name of the machine that asks. */
  readonly machine: string;
  readonly subject: MachineAskSubjectLine;
  /** When the ask's window closes, in epoch milliseconds. */
  readonly expiresAt: number;
  /** Whether its window closed with no answer, so an Allow now lets the agent try again. */
  readonly lapsed: boolean;
  /** The answer on its way, whose press reads busy while the others take nothing. */
  readonly answering: MachineAskDecision | undefined;
  /** Why the last answer did not go. */
  readonly note: string | undefined;
  /** Allow it, once or always. */
  readonly onAllow: (decision: MachineAskDecision) => void;
  /** Deny it, which asks for the optional words the agent is handed first. */
  readonly onDeny: () => void;
};

/** The clock, read again each second while `ticking`, so a countdown drawn from it moves; still otherwise. */
function useTickingNow(ticking: boolean): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!ticking) return;
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);

    return () => clearInterval(tick);
  }, [ticking]);

  return now;
}

/** Deny, Just this once and Always allow, Always allow filled; stacked at an accessibility size, as an alert's buttons stack. */
function AskPresses({
  answering,
  onAllow,
  onDeny,
}: Pick<MachineAskBannerProps, "answering" | "onAllow" | "onDeny">) {
  const large = useAccessibilitySize();
  const out = answering !== undefined;

  const presses = (
    <>
      <Button
        label={MACHINE_ASK_WORDS.DENY}
        look={BUTTON_LOOK.BORDERED}
        disabled={out}
        onPress={onDeny}
      />
      <Button
        label={MACHINE_ASK_WORDS.ONCE}
        look={BUTTON_LOOK.BORDERED}
        disabled={out}
        onPress={() => onAllow(MACHINE_ASK_DECISION.ALLOW_ONCE)}
      />
      <Button
        label={MACHINE_ASK_WORDS.ALWAYS}
        disabled={out}
        onPress={() => onAllow(MACHINE_ASK_DECISION.ALLOW_ALWAYS)}
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
 * What stands over an agent's composer, inside its glass, while one of the
 * developer's machines asks before it runs the agent's command or lets it
 * use an app: the machine's glyph and name in the attention ink with the
 * time the ask has left, or Timed out, after which an Allow still lets the
 * agent try again; what it asks, the command read whole at an accessibility
 * size since a reader allows what they can read; and the presses. The first
 * answer given on any of the developer's devices stands, and the banner goes
 * as the read carries it.
 */
export function MachineAskBanner({
  machine,
  subject,
  expiresAt,
  lapsed,
  answering,
  note,
  onAllow,
  onDeny,
}: MachineAskBannerProps) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const now = useTickingNow(!lapsed);

  const standing = lapsed
    ? MACHINE_ASK_WORDS.TIMED_OUT
    : MACHINE_ASK_WORDS.left(timeLeftText(expiresAt - now));

  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT * 2}>
      <HStack spacing={SPACE.ROW}>
        <Image
          {...glyphImage(GLYPH.MAC)}
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
          {MACHINE_ASK_WORDS.asks(machine)}
        </Text>
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE }),
            foregroundStyle(colors.TEXT_MUTED),
            monospacedDigit(),
          ]}
        >
          {standing}
        </Text>
      </HStack>
      <Text
        modifiers={[font({ textStyle: TYPE_ROLE.ROW_TITLE }), foregroundStyle(colors.TEXT_BODY)]}
      >
        {"command" in subject ? MACHINE_ASK_WORDS.SHELL : MACHINE_ASK_WORDS.app(subject.app)}
      </Text>
      {"command" in subject ? (
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE, design: "monospaced" }),
            foregroundStyle(colors.TEXT_MUTED),
            lineLimit(large ? 12 : 3),
          ]}
        >
          {subject.command}
        </Text>
      ) : null}
      {note === undefined ? null : <AskNote words={note} />}
      <AskPresses answering={answering} onAllow={onAllow} onDeny={onDeny} />
    </VStack>
  );
}

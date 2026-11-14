// machine-ask-sheet.tsx -- an ask one of the developer's machines holds for an agent, put to them on the phone as a sheet from the screen's foot over whatever screen stands: the machine and the time left, what it would run or use, Allow once, Always allow and Deny…, which asks for the words the agent is handed.

import {
  BottomSheet,
  Group,
  Host,
  HStack,
  Image,
  ScrollView,
  Spacer,
  Text,
  TextField,
  useNativeState,
  VStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityHidden,
  background,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  padding,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  textFieldStyle,
} from "@expo/ui/swift-ui/modifiers";
import { MACHINE_ASK_DECISION, type MachineAskDecision } from "@repo/features/machine-ask-wire";
import { timeLeftText } from "@repo/features/time-format";
import { type ReactNode, useEffect, useState } from "react";
import { BUTTON_LOOK, BUTTON_SIZE, Button } from "./button.js";
import { GLYPH, glyphImage } from "./glyph.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, RADIUS, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What the sheet says, in the words of the card the panel and the machine ask with. */
const MACHINE_ASK_WORDS = {
  SHELL: "Run this command?",
  app: (app: string) => `Let agents use ${app}?`,
  APP_DETAIL: "The agent sees and controls this app's windows.",
  left: (left: string) => `${left} left`,
  TIMED_OUT: "Timed out",
  ONCE: "Allow once",
  ALWAYS: "Always allow",
  DENY_ASK: "Deny…",
  DENY: "Deny",
  BACK: "Back",
  DENY_TITLE: "Deny this ask?",
  NOTE: "Tell the agent why (optional)",
} as const;

/** How often the time left is drawn again: each second, as the panel's countdown ticks. */
const TICK_MS = 1000;

/** Which of its two faces the sheet shows: the ask, or Deny's words for the agent. */
const ASK_FACE = { ASK: "ask", DENY: "deny" } as const;

type AskFace = (typeof ASK_FACE)[keyof typeof ASK_FACE];

/** What one machine's ask asks: a command to run, or an app to use. */
type MachineAskSheetSubject = { readonly command: string } | { readonly app: string };

type MachineAskSheetProps = {
  readonly presented: boolean;
  /** The name of the machine that asks. */
  readonly machine: string;
  readonly subject: MachineAskSheetSubject;
  /** When the ask's window closes, in epoch milliseconds; past it the sheet reads Timed out, and an Allow still lets the agent try again. */
  readonly expiresAt: number;
  /** Allow it, once or always. */
  readonly onAllow: (decision: MachineAskDecision) => void;
  /** Deny it, with the words the agent is handed, where the developer gave any. */
  readonly onDeny: (note: string | undefined) => void;
  /** Called as the sheet is dragged away unanswered, which sets the ask aside on this phone. */
  readonly onDismiss: () => void;
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

/** The sheet's head: the machine's glyph and name, and the time the ask has left, or Timed out. */
function AskHead({ machine, expiresAt }: { readonly machine: string; readonly expiresAt: number }) {
  const colors = useColors();
  const now = useTickingNow(true);

  const standing =
    now >= expiresAt
      ? MACHINE_ASK_WORDS.TIMED_OUT
      : MACHINE_ASK_WORDS.left(timeLeftText(expiresAt - now));

  return (
    <HStack spacing={SPACE.ROW}>
      <Image
        {...glyphImage(GLYPH.MAC)}
        size={MARK_SIZE.GLYPH}
        color={colors.TEXT_MUTED}
        modifiers={[accessibilityHidden()]}
      />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: "semibold" }),
          foregroundStyle(colors.TEXT_MUTED),
          lineLimit(1),
        ]}
      >
        {machine}
      </Text>
      <Spacer />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_TITLE }),
          foregroundStyle(colors.TEXT_MUTED),
          monospacedDigit(),
        ]}
      >
        {standing}
      </Text>
    </HStack>
  );
}

/** A title the sheet stands under, in the large bold a sheet's question reads in. */
function AskTitle({ words }: { readonly words: string }) {
  const colors = useColors();

  return (
    <Text
      modifiers={[
        font({ textStyle: "title2", weight: "bold" }),
        foregroundStyle(colors.TEXT),
        frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
      ]}
    >
      {words}
    </Text>
  );
}

/** What the ask is about: the command whole in a code block, or what using the app lets the agent do. */
function AskSubject({ subject }: { readonly subject: MachineAskSheetSubject }) {
  const colors = useColors();

  if (!("command" in subject)) {
    return (
      <Text
        modifiers={[font({ textStyle: TYPE_ROLE.ROW_TITLE }), foregroundStyle(colors.TEXT_BODY)]}
      >
        {MACHINE_ASK_WORDS.APP_DETAIL}
      </Text>
    );
  }

  return (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_TITLE, design: "monospaced" }),
        foregroundStyle(colors.TEXT),
        frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
        padding({ all: SPACE.ROW + SPACE.TIGHT / 2 }),
        background(
          colors.GROUPED,
          SwiftModifiers.shapes.roundedRectangle({ cornerRadius: RADIUS.CARD }),
        ),
      ]}
    >
      {subject.command}
    </Text>
  );
}

/** One face of the sheet: what it says, which scrolls where it runs past the sheet, as a long command does, over its acts, which stay at the foot. */
function SheetFace({ says, acts }: { readonly says: ReactNode; readonly acts: ReactNode }) {
  return (
    <VStack spacing={SPACE.EDGE}>
      <ScrollView>
        <VStack
          alignment="leading"
          spacing={SPACE.EDGE}
          modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" })]}
        >
          {says}
        </VStack>
      </ScrollView>
      <VStack spacing={SPACE.ROW}>{acts}</VStack>
    </VStack>
  );
}

/** The ask's face: the head, the question, what it asks, and Allow once filled, Always allow beside it, Deny… in red. */
function AskFaceView({
  machine,
  subject,
  expiresAt,
  onAllow,
  onDenyAsk,
}: Pick<MachineAskSheetProps, "machine" | "subject" | "expiresAt" | "onAllow"> & {
  readonly onDenyAsk: () => void;
}) {
  return (
    <SheetFace
      says={
        <>
          <AskHead machine={machine} expiresAt={expiresAt} />
          <AskTitle
            words={
              "command" in subject ? MACHINE_ASK_WORDS.SHELL : MACHINE_ASK_WORDS.app(subject.app)
            }
          />
          <AskSubject subject={subject} />
        </>
      }
      acts={
        <>
          <Button
            label={MACHINE_ASK_WORDS.ONCE}
            size={BUTTON_SIZE.LARGE}
            wide
            onPress={() => onAllow(MACHINE_ASK_DECISION.ALLOW_ONCE)}
          />
          <Button
            label={MACHINE_ASK_WORDS.ALWAYS}
            look={BUTTON_LOOK.BORDERED}
            size={BUTTON_SIZE.LARGE}
            wide
            onPress={() => onAllow(MACHINE_ASK_DECISION.ALLOW_ALWAYS)}
          />
          <Button
            label={MACHINE_ASK_WORDS.DENY_ASK}
            look={BUTTON_LOOK.PLAIN}
            size={BUTTON_SIZE.LARGE}
            destructive
            wide
            onPress={onDenyAsk}
          />
        </>
      }
    />
  );
}

/** Deny's face: the field for the words the agent is handed, Deny, and Back to the ask. */
function DenyFaceView({
  onDeny,
  onBack,
}: {
  readonly onDeny: (note: string | undefined) => void;
  readonly onBack: () => void;
}) {
  const colors = useColors();
  const note = useNativeState("");
  const [words, setWords] = useState("");

  return (
    <SheetFace
      says={
        <>
          <AskTitle words={MACHINE_ASK_WORDS.DENY_TITLE} />
          <TextField
            text={note}
            placeholder={MACHINE_ASK_WORDS.NOTE}
            onTextChange={setWords}
            modifiers={[
              textFieldStyle("plain"),
              font({ textStyle: TYPE_ROLE.ROW_TITLE }),
              foregroundStyle(colors.TEXT),
              padding({ all: SPACE.ROW + SPACE.TIGHT / 2 }),
              background(
                colors.GROUPED,
                SwiftModifiers.shapes.roundedRectangle({ cornerRadius: RADIUS.CARD }),
              ),
            ]}
          />
        </>
      }
      acts={
        <>
          <Button
            label={MACHINE_ASK_WORDS.DENY}
            size={BUTTON_SIZE.LARGE}
            destructive
            wide
            onPress={() => onDeny(words.trim() === "" ? undefined : words.trim())}
          />
          <Button
            label={MACHINE_ASK_WORDS.BACK}
            look={BUTTON_LOOK.PLAIN}
            size={BUTTON_SIZE.LARGE}
            wide
            onPress={onBack}
          />
        </>
      }
    />
  );
}

/**
 * A machine's ask as a sheet from the screen's foot, as the system's own
 * sheets and a chat app's tool approvals ask: the machine and the time it
 * has left at the head, the question in a sheet's large bold, the command
 * whole in a code block (or what using the app lets the agent do), then
 * Allow once filled, Always allow, and Deny…, which turns the sheet to the
 * words the agent is handed. It opens at half the screen and drags to the
 * whole; what it says scrolls where a long command runs past it, its acts
 * held at the foot, so a command is read whole before it is allowed. Dragged away,
 * it sets the ask aside on this phone. Note that it stands in a host of its
 * own, the size of nothing, as `RemindSheet` does, so it opens over
 * whatever screen stands.
 */
export function MachineAskSheet({
  presented,
  machine,
  subject,
  expiresAt,
  onAllow,
  onDeny,
  onDismiss,
}: MachineAskSheetProps) {
  const colors = useColors();
  const [face, setFace] = useState<AskFace>(ASK_FACE.ASK);

  return (
    <Host matchContents style={{ position: "absolute" }}>
      <BottomSheet
        isPresented={presented}
        onIsPresentedChange={(shown) => {
          if (!shown) onDismiss();
        }}
        onDismiss={() => setFace(ASK_FACE.ASK)}
      >
        <Group
          modifiers={[
            presentationDetents(["medium", "large"]),
            presentationDragIndicator("visible"),
            presentationBackground(colors.RAISED),
          ]}
        >
          <VStack
            modifiers={[
              padding({ horizontal: SPACE.PAGE, top: SPACE.PAGE + SPACE.ROW, bottom: SPACE.ROW }),
            ]}
          >
            {face === ASK_FACE.DENY ? (
              <DenyFaceView onDeny={onDeny} onBack={() => setFace(ASK_FACE.ASK)} />
            ) : (
              <AskFaceView
                machine={machine}
                subject={subject}
                expiresAt={expiresAt}
                onAllow={onAllow}
                onDenyAsk={() => setFace(ASK_FACE.DENY)}
              />
            )}
          </VStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}

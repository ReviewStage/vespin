// call.tsx -- a voice call into an agent as the phone draws it: Talk in an agent's composer, the call's presses there while the call is into that agent, and the slim way back to the call's agent over the tab bar from every other screen.

import {
  Host,
  HStack,
  Image,
  Spacer,
  Button as SwiftUIButton,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityHint,
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import type { ModelProvider } from "@repo/features/models-wire";
import { CALL_CONTROL_LABEL, TALK_LABEL } from "@repo/features/voice-call-words";
import { StyleSheet } from "react-native";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { AgentTile } from "./marks.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What a composer offers of calls: Talk at rest, or the call's presses while a call into its agent stands. */
export const COMPOSER_CALL = {
  TALK: "talk",
  ON_CALL: "on-call",
} as const;

/** A call's presses: the two mutes as they stand, each press asking for its other side, and End call. */
export interface CallPresses {
  readonly microphoneMuted: boolean;
  readonly speakerMuted: boolean;
  readonly onMicrophone: () => void;
  readonly onSpeaker: () => void;
  readonly onEnd: () => void;
}

/** What a composer draws of calls, by `COMPOSER_CALL`. */
export type ComposerCall =
  | { readonly kind: typeof COMPOSER_CALL.TALK; readonly onTalk: () => void }
  | { readonly kind: typeof COMPOSER_CALL.ON_CALL; readonly presses: CallPresses };

/** The call standing, as its way back draws it. */
export interface StandingCallCard {
  readonly agentName: string;
  /** The harness the agent's tile wears; none where it is not known. */
  readonly harness: ModelProvider | undefined;
  /** The call's task by name; none where its task is not listed. */
  readonly taskName: string | undefined;
  /** Where the call stands or what its agent does, in words; none while it is up and its agent idle. */
  readonly line: string | undefined;
  readonly presses: CallPresses;
}

/** The tile's size in the way back: a row's mark, a step larger where the accessory stands full. */
const TILE_SIZE = { FULL: MARK_SIZE.AVATAR, INLINE: MARK_SIZE.LEAD } as const;

/** What a press on the way back is heard to do. */
const OPEN_HINT = "Opens the agent on the call";

const styles = StyleSheet.create({
  // The way back's SwiftUI takes the accessory's whole room.
  accessory: { flex: 1 },
});

/** A press's frame in a row of glyph buttons: Apple's least target, its mark centered, the whole frame taking the press. */
const PRESS_FRAME = [
  frame({ minWidth: PRESS_SIZE, minHeight: PRESS_SIZE }),
  SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
];

/** One glyph button of a call, borderless in the ink or in danger's red, named for a reader by what it does. */
function CallGlyphPress({
  glyph,
  label,
  danger = false,
  onPress,
}: {
  readonly glyph: Glyph;
  readonly label: string;
  readonly danger?: boolean | undefined;
  readonly onPress: () => void;
}) {
  const colors = useColors();

  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[buttonStyle("borderless"), ...PRESS_FRAME, accessibilityLabel(label)]}
    >
      <Image
        {...glyphImage(glyph)}
        size={MARK_SIZE.LEAD + 2}
        color={danger ? colors.DANGER_TEXT : colors.TEXT_MUTED}
      />
    </SwiftUIButton>
  );
}

/**
 * Talk, the waveform a composer offers while its field is empty, which
 * calls the composer's agent, as the panel's box offers it beside Dictate.
 */
function TalkPress({ onTalk }: { readonly onTalk: () => void }) {
  return <CallGlyphPress glyph={GLYPH.TALK} label={TALK_LABEL.TALK} onPress={onTalk} />;
}

/**
 * The call's presses in the panel's order: the speaker's mute, the
 * microphone's, and End call in red. A mute shows where it stands, its
 * glyph struck through while muted, and is named for what a press does;
 * `speaker` false leaves the speaker's out, as the way back's inline look
 * does for room.
 */
function CallPressRow({
  presses,
  speaker = true,
}: {
  readonly presses: CallPresses;
  readonly speaker?: boolean | undefined;
}) {
  return (
    <>
      {speaker ? (
        <CallGlyphPress
          glyph={presses.speakerMuted ? GLYPH.SPEAKER_MUTED : GLYPH.SPEAKER}
          label={
            presses.speakerMuted
              ? CALL_CONTROL_LABEL.UNMUTE_SPEAKER
              : CALL_CONTROL_LABEL.MUTE_SPEAKER
          }
          onPress={presses.onSpeaker}
        />
      ) : null}
      <CallGlyphPress
        glyph={presses.microphoneMuted ? GLYPH.MICROPHONE_MUTED : GLYPH.MICROPHONE}
        label={
          presses.microphoneMuted
            ? CALL_CONTROL_LABEL.UNMUTE_MICROPHONE
            : CALL_CONTROL_LABEL.MUTE_MICROPHONE
        }
        onPress={presses.onMicrophone}
      />
      <CallGlyphPress
        glyph={GLYPH.END_CALL}
        label={CALL_CONTROL_LABEL.END_CALL}
        danger
        onPress={presses.onEnd}
      />
    </>
  );
}

/** What a composer draws of calls in its row, before Send: Talk, or the call's presses. */
export function ComposerCallPresses({ call }: { readonly call: ComposerCall }) {
  if (call.kind === COMPOSER_CALL.TALK) return <TalkPress onTalk={call.onTalk} />;

  return <CallPressRow presses={call.presses} />;
}

/**
 * The call standing as one row, the panel's call card laid flat: the
 * agent's tile and name, which together open it, over the call's line or,
 * while it has none, its task, in the muted ink, and the mutes and End call
 * at its end. Where room is short (`inline`), it keeps the tile, the name,
 * the microphone's mute and End call. It carries no words of the
 * conversation and decides nothing: every press is handed back to its
 * owner, which holds the call. It stands over the tab bar
 * (`CallAccessory`), and over the composer of an agent the call is not
 * into, where the tab bar steps aside.
 */
export function CallCardRow({
  call,
  inline = false,
  onOpen,
}: {
  readonly call: StandingCallCard;
  readonly inline?: boolean | undefined;
  readonly onOpen: () => void;
}) {
  const colors = useColors();
  const second = call.line ?? call.taskName;

  return (
    <HStack spacing={SPACE.TIGHT}>
      <SwiftUIButton
        onPress={onOpen}
        modifiers={[
          buttonStyle("plain"),
          accessibilityLabel(call.agentName),
          accessibilityHint(OPEN_HINT),
        ]}
      >
        <HStack spacing={SPACE.TIGHT * 2}>
          <AgentTile
            name={call.agentName}
            harness={call.harness}
            size={inline ? TILE_SIZE.INLINE : TILE_SIZE.FULL}
          />
          <VStack alignment="leading" spacing={0}>
            <Text
              modifiers={[
                font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: "medium" }),
                foregroundStyle(colors.TEXT),
                lineLimit(1),
              ]}
            >
              {call.agentName}
            </Text>
            {inline || second === undefined ? null : (
              <Text
                modifiers={[
                  font({ textStyle: TYPE_ROLE.ROW_LINE }),
                  foregroundStyle(colors.TEXT_MUTED),
                  lineLimit(1),
                ]}
              >
                {second}
              </Text>
            )}
          </VStack>
          <Spacer />
        </HStack>
      </SwiftUIButton>
      <CallPressRow presses={call.presses} speaker={!inline} />
    </HStack>
  );
}

/**
 * The slim way back to a call's agent from any other screen, drawn in the
 * tab bar's bottom accessory as Music draws what plays, its look the inline
 * one where the tab bar has shrunk as a list scrolled (`inline`).
 */
export function CallAccessory({
  call,
  inline,
  onOpen,
}: {
  readonly call: StandingCallCard;
  readonly inline: boolean;
  readonly onOpen: () => void;
}) {
  return (
    <Host style={styles.accessory}>
      <VStack modifiers={[padding({ leading: SPACE.ROW })]}>
        <CallCardRow call={call} inline={inline} onOpen={onOpen} />
      </VStack>
    </Host>
  );
}

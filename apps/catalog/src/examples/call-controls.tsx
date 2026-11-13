/**
 * call-controls.tsx -- Talk at rest and with no OpenAI API key; each mute round and square, off and on, and the one red End call; a box's call status connecting, live, muted, and ending; a call bar at a card's width and at its narrowest, while the agent thinks and works, and muted; and the call card at the sidebar's foot and in the floating window.
 */

import {
  BUTTON_CORNERS,
  type ButtonCorners,
  CALL_CARD_SURFACE,
  CALL_DEVICE,
  CALL_STAGE,
  CallBar,
  CallCard,
  type CallDevice,
  CallLive,
  CallMute,
  type CallStatus,
  EndCallButton,
  GAP,
  Inline,
  Stack,
  TalkButton,
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/** When the catalog's call started, and the moment its count stands still at: 4m 12s in. */
const CALL_STARTED_AT = Date.UTC(2026, 9, 24, 15, 0, 0);
const CALL_NOW = CALL_STARTED_AT + 252_000;

/** The task the catalog's card is about. */
const TASK_NAME = "Voice mode for agents";

/** A press the catalog has nowhere to take. */
function stay(): void {}

const LISTENING: CallStatus = { voiceWord: "Listening", agent: undefined };

const THINKING: CallStatus = { voiceWord: "Listening", agent: { action: undefined } };

const WORKING: CallStatus = {
  voiceWord: "Speaking",
  agent: { action: "pnpm exec vitest run packages/ui/src/components/call" },
};

/** The two mutes as a call's owner would hold them, each toggling on its press, both on where `muted`. */
function useMutes(muted = false) {
  const [microphone, setMicrophone] = useState(muted);
  const [speaker, setSpeaker] = useState(muted);

  return {
    microphone: { muted: microphone, onPress: () => setMicrophone((was) => !was) },
    speaker: { muted: speaker, onPress: () => setSpeaker((was) => !was) },
  };
}

/** A bar whose mutes toggle, at `width`, both on where `muted`. */
function OwnedBar({
  status,
  width,
  muted = false,
}: {
  status: CallStatus;
  width: number;
  muted?: boolean;
}): React.JSX.Element {
  const mutes = useMutes(muted);

  return (
    <div style={{ width }}>
      <CallBar status={status} {...mutes} onEnd={stay} />
    </div>
  );
}

/** A card whose mutes toggle, at `width`, drawn where `surface` says. */
function OwnedCard({
  status,
  width,
  surface,
}: {
  status: CallStatus;
  width: number;
  surface: (typeof CALL_CARD_SURFACE)[keyof typeof CALL_CARD_SURFACE];
}): React.JSX.Element {
  const mutes = useMutes();

  return (
    <div style={{ width }}>
      <CallCard
        name={TASK_NAME}
        status={status}
        {...mutes}
        surface={surface}
        onReturn={stay}
        onEnd={stay}
      />
    </div>
  );
}

/** One mute that toggles, at the corners given, on from the start where `on`. */
function OwnedMute({
  device,
  corners,
  on = false,
}: {
  device: CallDevice;
  corners: ButtonCorners;
  on?: boolean;
}): React.JSX.Element {
  const [muted, setMuted] = useState(on);

  return (
    <CallMute
      device={device}
      muted={muted}
      corners={corners}
      onPress={() => setMuted((was) => !was)}
    />
  );
}

function CallControls(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="call-talk" title="Talk, and Talk with no OpenAI API key">
        <Inline gap={GAP.CONTROL}>
          <TalkButton onPress={stay} />
          <TalkButton keyMissing onPress={stay} />
        </Inline>
      </CatalogSection>
      <CatalogSection id="call-controls" title="Mutes round and square, both muted, and End call">
        <Inline gap={GAP.CONTROL}>
          <OwnedMute device={CALL_DEVICE.SPEAKER} corners={BUTTON_CORNERS.ROUND} />
          <OwnedMute device={CALL_DEVICE.MICROPHONE} corners={BUTTON_CORNERS.ROUND} />
          <OwnedMute device={CALL_DEVICE.SPEAKER} corners={BUTTON_CORNERS.SQUARE} />
          <OwnedMute device={CALL_DEVICE.MICROPHONE} corners={BUTTON_CORNERS.SQUARE} />
          <OwnedMute device={CALL_DEVICE.SPEAKER} corners={BUTTON_CORNERS.ROUND} on />
          <OwnedMute device={CALL_DEVICE.MICROPHONE} corners={BUTTON_CORNERS.ROUND} on />
          <EndCallButton onPress={stay} />
        </Inline>
      </CatalogSection>
      <CatalogSection
        id="call-live"
        title="A call's status in a box's foot: connecting, live, muted, and ending"
      >
        <Inline gap={GAP.SECTION}>
          <CallLive stage={CALL_STAGE.CONNECTING} />
          <CallLive
            stage={CALL_STAGE.LIVE}
            startedAt={CALL_STARTED_AT}
            muted={false}
            now={CALL_NOW}
          />
          <CallLive stage={CALL_STAGE.LIVE} startedAt={CALL_STARTED_AT} muted now={CALL_NOW} />
          <CallLive stage={CALL_STAGE.ENDING} />
        </Inline>
      </CatalogSection>
      <CatalogSection
        id="call-bar"
        title="The call bar listening, thinking, working, and muted, then at its narrowest"
      >
        <Stack gap={GAP.SECTION}>
          <OwnedBar status={LISTENING} width={320} />
          <OwnedBar status={THINKING} width={320} />
          <OwnedBar status={WORKING} width={320} />
          <OwnedBar status={LISTENING} width={320} muted />
          <OwnedBar status={WORKING} width={200} />
        </Stack>
      </CatalogSection>
      <CatalogSection
        id="call-card"
        title="The call card at the sidebar's foot, narrow, and in the floating window"
      >
        <Stack gap={GAP.SECTION}>
          <OwnedCard status={WORKING} width={280} surface={CALL_CARD_SURFACE.SIDEBAR} />
          <OwnedCard status={THINKING} width={220} surface={CALL_CARD_SURFACE.SIDEBAR} />
          <OwnedCard status={LISTENING} width={320} surface={CALL_CARD_SURFACE.WINDOW} />
        </Stack>
      </CatalogSection>
    </>
  );
}

export const CALL_CONTROLS_EXAMPLE: Example = {
  id: "call",
  title: "Call controls",
  Render: CallControls,
};

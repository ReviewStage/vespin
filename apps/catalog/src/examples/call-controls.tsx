/**
 * call-controls.tsx -- Talk at rest and with no OpenAI API key; each mute round and square, off and on, Stop, and the one red End call; a box's call status connecting, live, muted, and ending; a call bar at a card's width and at its narrowest, connecting, idle, while the agent thinks and works, and muted; and the call card at the sidebar's foot, narrow, and in the floating window, its agent's chip over its task.
 */

import { MODEL_PROVIDER } from "@repo/features/models-wire";
import {
  AVATAR_OUTLINE,
  AVATAR_SIZE,
  Avatar,
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
  HarnessMark,
  Inline,
  Stack,
  StopAgentButton,
  TalkButton,
  WorkingMark,
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/** When the catalog's call started, and the moment its count stands still at: 4m 12s in. */
const CALL_STARTED_AT = Date.UTC(2026, 9, 24, 15, 0, 0);
const CALL_NOW = CALL_STARTED_AT + 252_000;

/** The task the catalog's card is about, and the agent it is with. */
const TASK_NAME = "Voice mode for agents";
const AGENT_NAME = "Redesign the call card";

/** A press the catalog has nowhere to take. */
function stay(): void {}

const CONNECTING: CallStatus = { stageWord: "Connecting…", agent: undefined };

const IDLE: CallStatus = { stageWord: undefined, agent: undefined };

const THINKING: CallStatus = { stageWord: undefined, agent: { action: undefined } };

const WORKING: CallStatus = {
  stageWord: undefined,
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
      <CallBar status={status} {...mutes} onStop={stay} onEnd={stay} />
    </div>
  );
}

/** The agent's tile as the panel draws it: its harness's mark on its square, the working mark in its place while it works. */
function AgentTile({ working }: { working: boolean }): React.JSX.Element {
  return (
    <Avatar
      name={AGENT_NAME}
      glyph={working ? <WorkingMark /> : <HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} />}
      outline={AVATAR_OUTLINE.SQUARE}
      size={AVATAR_SIZE.INLINE}
      decorative
    />
  );
}

/** A card whose mutes toggle, at `width`, drawn where `surface` says, both mutes on where `muted`. */
function OwnedCard({
  status,
  width,
  surface,
  muted = false,
}: {
  status: CallStatus;
  width: number;
  surface: (typeof CALL_CARD_SURFACE)[keyof typeof CALL_CARD_SURFACE];
  muted?: boolean;
}): React.JSX.Element {
  const mutes = useMutes(muted);
  const working = status.stageWord === undefined && status.agent !== undefined;

  return (
    <div style={{ width }}>
      <CallCard
        agent={{ name: AGENT_NAME, tile: <AgentTile working={working} /> }}
        taskName={TASK_NAME}
        status={status}
        {...mutes}
        surface={surface}
        onReturn={stay}
        onStop={stay}
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
      <CatalogSection
        id="call-controls"
        title="Mutes round and square, both muted, Stop, and End call"
      >
        <Inline gap={GAP.CONTROL}>
          <OwnedMute device={CALL_DEVICE.SPEAKER} corners={BUTTON_CORNERS.ROUND} />
          <OwnedMute device={CALL_DEVICE.MICROPHONE} corners={BUTTON_CORNERS.ROUND} />
          <OwnedMute device={CALL_DEVICE.SPEAKER} corners={BUTTON_CORNERS.SQUARE} />
          <OwnedMute device={CALL_DEVICE.MICROPHONE} corners={BUTTON_CORNERS.SQUARE} />
          <OwnedMute device={CALL_DEVICE.SPEAKER} corners={BUTTON_CORNERS.ROUND} on />
          <OwnedMute device={CALL_DEVICE.MICROPHONE} corners={BUTTON_CORNERS.ROUND} on />
          <StopAgentButton onPress={stay} />
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
        title="The call bar connecting, idle, thinking, working, and muted, then at its narrowest"
      >
        <Stack gap={GAP.SECTION}>
          <OwnedBar status={CONNECTING} width={320} />
          <OwnedBar status={IDLE} width={320} />
          <OwnedBar status={THINKING} width={320} />
          <OwnedBar status={WORKING} width={320} />
          <OwnedBar status={IDLE} width={320} muted />
          <OwnedBar status={WORKING} width={200} />
        </Stack>
      </CatalogSection>
      <CatalogSection
        id="call-card"
        title="The call card at the sidebar's foot working and muted, narrow, and in the floating window thinking and idle"
      >
        <Stack gap={GAP.SECTION}>
          <OwnedCard status={WORKING} width={280} surface={CALL_CARD_SURFACE.SIDEBAR} />
          <OwnedCard status={IDLE} width={280} surface={CALL_CARD_SURFACE.SIDEBAR} muted />
          <OwnedCard status={THINKING} width={220} surface={CALL_CARD_SURFACE.SIDEBAR} />
          <OwnedCard status={THINKING} width={320} surface={CALL_CARD_SURFACE.WINDOW} />
          <OwnedCard status={IDLE} width={320} surface={CALL_CARD_SURFACE.WINDOW} />
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

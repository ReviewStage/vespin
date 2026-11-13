/**
 * voice-calls.tsx -- what a call into an agent leaves in its transcript: the rule it begins at, a line the caller said aloud led by the spoken mark, the turn it opened folded closed, the voice's own line retelling it under "Voice" in the muted ink, each saying when into the call it began on hover, and the rule it ends at with how long it ran.
 */

import {
  BUTTON_SIZE,
  CALL_MARK_END,
  CallMark,
  CallOffset,
  CopyIcon,
  IconButton,
  MESSAGE_LINE_ALIGN,
  MESSAGE_LINE_INSET,
  MessageActions,
  MessageFrame,
  MessageLine,
  RetoldTurn,
  SpokenMark,
  Text,
  TIME_LOOK,
  Time,
  VoiceSpeaker,
  VoiceWords,
} from "@repo/ui";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/** A line's actions, its time into the call before its Copy, shown while the pointer rests on it. */
function lineActions(clock: string): React.JSX.Element {
  return (
    <MessageActions>
      <CallOffset clock={clock} />
      <IconButton icon={<CopyIcon />} label="Copy" size={BUTTON_SIZE.COMPACT} onClick={() => {}} />
    </MessageActions>
  );
}

/** Oct 14, 2026, 3:42 PM, on the viewer's own clock. */
const SAID_AT = new Date(2026, 9, 14, 15, 42).getTime();

function VoiceCalls(): React.JSX.Element {
  return (
    <CatalogSection
      id="voice-call"
      title="A call: its rules, a line said aloud, the turn it opened folded, and the voice retelling it"
    >
      <div className="catalog-frame">
        <CallMark end={CALL_MARK_END.START}>
          Call started
          <span aria-hidden="true">·</span>
          <Time at={SAID_AT} look={TIME_LOOK.DAY} />
        </CallMark>
        <MessageFrame revealActionsOnTap>
          <Text>Can you make the invite expire after three days?</Text>
          <MessageLine sender={<SpokenMark />} actions={lineActions("0:01")} />
        </MessageFrame>
        <RetoldTurn summary="Retold on the call · 2m 14s">
          <Text>An invite now expires after three days. The members tests pass.</Text>
        </RetoldTurn>
        <MessageFrame revealActionsOnTap>
          <VoiceSpeaker />
          <VoiceWords>Done. Invites now expire after three days, and the tests pass.</VoiceWords>
          <MessageLine
            align={MESSAGE_LINE_ALIGN.START}
            inset={MESSAGE_LINE_INSET.FLUSH}
            actions={lineActions("2:20")}
          />
        </MessageFrame>
        <CallMark end={CALL_MARK_END.END}>Call ended · 2m 45s</CallMark>
      </div>
    </CatalogSection>
  );
}

export const VOICE_CALLS_EXAMPLE: Example = {
  id: "voice-calls",
  title: "Voice calls",
  Render: VoiceCalls,
};

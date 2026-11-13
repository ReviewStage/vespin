/**
 * voice-calls.tsx -- what a call into an agent adds to its transcript: the rule it begins at, the turn a spoken ask opened folded closed under its finished line's words, and the rule it ends at with how long it ran.
 */

import { CALL_MARK_END, CallMark, RetoldTurn, Text, TIME_LOOK, Time } from "@repo/ui";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/** Oct 14, 2026, 3:42 PM, on the viewer's own clock. */
const SAID_AT = new Date(2026, 9, 14, 15, 42).getTime();

function VoiceCalls(): React.JSX.Element {
  return (
    <CatalogSection
      id="voice-call"
      title="A call's rules, and the turn a spoken ask opened folded between them"
    >
      <div className="catalog-frame">
        <CallMark end={CALL_MARK_END.START}>
          Call started
          <span aria-hidden="true">·</span>
          <Time at={SAID_AT} look={TIME_LOOK.DAY} />
        </CallMark>
        <RetoldTurn summary="Worked for 2m 14s · 3 tool calls">
          <Text>An invite now expires after three days. The members tests pass.</Text>
        </RetoldTurn>
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

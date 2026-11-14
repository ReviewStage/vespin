/**
 * voice-calls.tsx -- what a call into an agent adds to its transcript: the rule it begins at, and the rule it ends at with how long it ran.
 */

import { CALL_MARK_END, CallMark, TIME_LOOK, Time } from "@repo/ui";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/** Oct 14, 2026, 3:42 PM, on the viewer's own clock. */
const SAID_AT = new Date(2026, 9, 14, 15, 42).getTime();

function VoiceCalls(): React.JSX.Element {
  return (
    <CatalogSection id="voice-call" title="A call's rules">
      <div className="catalog-frame">
        <CallMark end={CALL_MARK_END.START}>
          Call started
          <span aria-hidden="true">·</span>
          <Time at={SAID_AT} look={TIME_LOOK.DAY} />
        </CallMark>
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

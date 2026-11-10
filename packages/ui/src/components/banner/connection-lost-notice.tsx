/** connection-lost-notice.tsx -- the notice kept in a conversation where its agent lost the connection to the model's provider and waited for it. */
import type { ConnectionLostNotice as Notice } from "@repo/wire/ui-messages";
import { GLYPH } from "../../icons/icons.js";
import { STATUS_TONE } from "../../status-tone.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { BANNER_GLYPH, BANNER_LOOK, Banner } from "./banner.js";

/** What the notice says under the loss: that the agent waits, or when the host answered again. */
function connectionLostCaption(notice: Notice, now: number = Date.now()): string {
  if (notice.restoredAt === null) return "Carries on when it's back";
  const at = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
    notice.restoredAt,
  );
  // Note that a restore in the future reads as now: the clocks differ, not the order of events.
  return notice.restoredAt > now ? "Back now" : `Back at ${at}`;
}

export function ConnectionLostNotice({ notice }: { notice: Notice }): React.JSX.Element {
  return (
    <Banner
      look={BANNER_LOOK.CARD}
      tone={notice.restoredAt === null ? STATUS_TONE.WORKING : STATUS_TONE.NEUTRAL}
      glyph={<GLYPH.DISCONNECT />}
      glyphLook={BANNER_GLYPH.MARK}
    >
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.LABEL}>
        {`Lost the connection to ${notice.provider}`}
      </Text>
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {connectionLostCaption(notice)}
      </Text>
    </Banner>
  );
}

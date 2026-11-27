/** connection-lost-notice.tsx -- the notice kept in a conversation where its agent lost the connection to the model's provider and waited for it. */
import { connectionLostCaption, connectionLostWords } from "@repo/features/agent-notice-words";
import type { ConnectionLostNotice as Notice } from "@repo/wire/ui-messages";
import { GLYPH } from "../../icons/icons.js";
import { STATUS_TONE } from "../../status-tone.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { BANNER_GLYPH, BANNER_LOOK, Banner } from "./banner.js";

export function ConnectionLostNotice({ notice }: { notice: Notice }): React.JSX.Element {
  return (
    <Banner
      look={BANNER_LOOK.CARD}
      tone={notice.restoredAt === null ? STATUS_TONE.WORKING : STATUS_TONE.NEUTRAL}
      glyph={<GLYPH.CONNECTION_LOST />}
      glyphLook={BANNER_GLYPH.MARK}
    >
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.LABEL}>
        {connectionLostWords(notice)}
      </Text>
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {connectionLostCaption(notice)}
      </Text>
    </Banner>
  );
}

/** usage-limit-notice.tsx -- the warning kept in a conversation where its agent moved to its next plan or key, paused, or stopped at its usage limit. */
import type { UsageLimitNotice as Notice } from "@repo/wire/ui-messages";
import { GLYPH } from "../../icons/icons.js";
import { STATUS_TONE } from "../../status-tone.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { BANNER_GLYPH, BANNER_LOOK, Banner } from "./banner.js";

/** What the card's muted line says: the payer the turn went on with, when it resumes, or that it waits on the reader. */
function nextWords(notice: Notice): string {
  if (notice.moved !== undefined) return `Continuing on ${notice.moved.to}`;
  if (notice.resetsAt === null) return "Send a message to continue";
  const reset = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
    notice.resetsAt,
  );
  return `Resumes at ${reset}`;
}

export function UsageLimitNotice({ notice }: { notice: Notice }): React.JSX.Element {
  const on = notice.moved === undefined ? "" : ` on ${notice.moved.from}`;
  return (
    <Banner
      look={BANNER_LOOK.CARD}
      tone={STATUS_TONE.ATTENTION}
      glyph={<GLYPH.TIME />}
      glyphLook={BANNER_GLYPH.MARK}
    >
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.LABEL}>
        {`${notice.agent} usage limit reached${on}`}
      </Text>
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {nextWords(notice)}
      </Text>
    </Banner>
  );
}

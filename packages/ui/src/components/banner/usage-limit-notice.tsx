/** usage-limit-notice.tsx -- the warning kept in a conversation where its agent moved to its next plan or key, paused, or stopped at its usage limit. */
import { dueText } from "@repo/features/time-format";
import type { UsageLimitNotice as Notice } from "@repo/wire/ui-messages";
import { GLYPH } from "../../icons/icons.js";
import { STATUS_TONE } from "../../status-tone.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { BANNER_GLYPH, BANNER_LOOK, Banner } from "./banner.js";

/** How much the notice says: its title over what comes next, or its title alone, as a worker the limit stopped, which goes on with no one, says it. */
export const USAGE_LIMIT_NOTICE_LOOK = { FULL: "full", TITLE: "title" } as const;

export type UsageLimitNoticeLook =
  (typeof USAGE_LIMIT_NOTICE_LOOK)[keyof typeof USAGE_LIMIT_NOTICE_LOOK];

/** What the card's muted line says: the payer the turn went on with, when it resumes, or that it waits on the reader. */
function nextWords(notice: Notice): string {
  if (notice.moved !== undefined) return `Continuing on ${notice.moved.to}`;

  if (notice.resetsAt === null) return "Send a message to continue";

  return `Resumes at ${dueText(notice.resetsAt, Date.now())}`;
}

export function UsageLimitNotice({
  notice,
  look = USAGE_LIMIT_NOTICE_LOOK.FULL,
}: {
  notice: Notice;
  /** Its title over what comes next, or its title alone. */
  look?: UsageLimitNoticeLook | undefined;
}): React.JSX.Element {
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
      {look === USAGE_LIMIT_NOTICE_LOOK.TITLE ? null : (
        <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {nextWords(notice)}
        </Text>
      )}
    </Banner>
  );
}

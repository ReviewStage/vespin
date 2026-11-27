/** usage-limit-notice.tsx -- the warning kept in a conversation where its agent moved to its next plan or key, paused, or stopped at its usage limit. */
import {
  RESET_CREDIT_WORDS,
  usageLimitNext,
  usageLimitTitle,
} from "@repo/features/usage-limit-words";
import type { UsageLimitNotice as Notice } from "@repo/wire/ui-messages";
import { GLYPH } from "../../icons/icons.js";
import { STATUS_TONE } from "../../status-tone.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { BANNER_GLYPH, BANNER_LOOK, Banner } from "./banner.js";

/** How much the notice says: its title over what comes next, or its title alone, as a worker the limit stopped, which goes on with no one, says it. */
export const USAGE_LIMIT_NOTICE_LOOK = { FULL: "full", TITLE: "title" } as const;

export type UsageLimitNoticeLook =
  (typeof USAGE_LIMIT_NOTICE_LOOK)[keyof typeof USAGE_LIMIT_NOTICE_LOOK];

/** A rate-limit reset credit offered on a pause: Use reset as its caller's press stands. */
export interface UsageLimitReset {
  readonly use: () => void;
  readonly busy: boolean;
}

export function UsageLimitNotice({
  notice,
  look = USAGE_LIMIT_NOTICE_LOOK.FULL,
  reset,
}: {
  notice: Notice;
  /** Its title over what comes next, or its title alone. */
  look?: UsageLimitNoticeLook | undefined;
  /** The reset credit a pause offers, drawn as Use reset; none where it offers none. */
  reset?: UsageLimitReset | undefined;
}): React.JSX.Element {
  return (
    <Banner
      look={BANNER_LOOK.CARD}
      tone={STATUS_TONE.ATTENTION}
      glyph={<GLYPH.TIME />}
      glyphLook={BANNER_GLYPH.MARK}
      actions={
        reset === undefined ? undefined : (
          <Button
            variant={BUTTON_VARIANT.OUTLINE}
            busy={reset.busy}
            busyLabel={RESET_CREDIT_WORDS.RUNNING}
            onClick={reset.use}
          >
            {RESET_CREDIT_WORDS.VERB}
          </Button>
        )
      }
    >
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.LABEL}>
        {usageLimitTitle(notice)}
      </Text>
      {look === USAGE_LIMIT_NOTICE_LOOK.TITLE ? null : (
        <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {usageLimitNext(notice)}
        </Text>
      )}
    </Banner>
  );
}

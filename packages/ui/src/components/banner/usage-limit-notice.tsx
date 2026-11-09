/** usage-limit-notice.tsx -- the warning kept in a conversation where its agent paused or stopped at its usage limit. */
import type { UsageLimitNotice as Notice } from "@repo/wire/ui-messages";
import { PauseIcon } from "../../icons/icons.js";
import { STATUS_TONE } from "../../status-tone.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { BANNER_GLYPH, BANNER_LOOK, Banner } from "./banner.js";

export function UsageLimitNotice({ notice }: { notice: Notice }): React.JSX.Element {
  const paused = notice.resetsAt !== null;
  const reset =
    notice.resetsAt === null
      ? undefined
      : new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
          notice.resetsAt,
        );
  return (
    <Banner
      look={BANNER_LOOK.CARD}
      tone={STATUS_TONE.ATTENTION}
      glyph={<PauseIcon />}
      glyphLook={BANNER_GLYPH.MARK}
    >
      <Text
        as={TEXT_ELEMENT.P}
        variant={TEXT_VARIANT.LABEL}
      >{`${paused ? "Paused" : "Stopped"} at your ${notice.agent} usage limit`}</Text>
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {paused ? `Picks up again when it resets at ${reset}` : "Send a message to carry on"}
      </Text>
    </Banner>
  );
}

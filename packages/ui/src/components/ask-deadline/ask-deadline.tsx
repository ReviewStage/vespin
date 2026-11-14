import { TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { TIME_LOOK, Time } from "../time/time.js";

/**
 * ask-deadline.tsx -- how long an ask put to the developer has left, counted down to the instant it closes, as "4:12 left".
 *
 * An ask that waits on the developer closes by itself at an instant its
 * owner names (`expiresAt`, epoch milliseconds on the window's own clock),
 * so a slow answer is never a mystery: the prompt says how long it stands,
 * and a row waiting on it says the same through the same `Time` look
 * (`TIME_LOOK.LEFT`), so both move on the window's second together.
 */

/** What the count says after its minutes and seconds. */
const LEFT = "left";

/** The time an ask has left, muted and in the caption's type: "4:12 left". */
export function AskDeadline({ expiresAt }: { expiresAt: number }): React.JSX.Element {
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      <Time at={expiresAt} look={TIME_LOOK.LEFT} /> {LEFT}
    </Text>
  );
}

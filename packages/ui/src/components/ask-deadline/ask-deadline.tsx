import { TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { useSecond } from "../time/time-clock.js";

/**
 * ask-deadline.tsx -- how long an ask put to the developer has left, counted down to the instant it closes, as "4:12 left".
 *
 * An ask that waits on the developer closes by itself at an instant its
 * owner names (`expiresAt`, epoch milliseconds on the window's own clock),
 * so a slow answer is never a mystery: the prompt says how long it stands,
 * and a row waiting on it says the same (`askTimeLeft`). The count moves on
 * the window's second (`useSecond`), so every count on screen moves on the
 * same instant, and it stops at 0:00 rather than going below.
 */

/** What a count says once its minutes and seconds are said: what is left. */
const LEFT = "left";

/** The time from `now` to `expiresAt` as minutes and seconds, "4:12", never below "0:00". */
export function askTimeLeft(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const minutes = Math.floor(seconds / 60);

  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The time an ask has left, moved on each second while it stands: "4:12", as a row waiting on it says it. */
export function useAskTimeLeft(expiresAt: number): string {
  return askTimeLeft(expiresAt, useSecond());
}

/** The time an ask has left, muted and in the caption's type: "4:12 left". */
export function AskDeadline({ expiresAt }: { expiresAt: number }): React.JSX.Element {
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      {`${useAskTimeLeft(expiresAt)} ${LEFT}`}
    </Text>
  );
}

/**
 * push-device-model.ts -- what a phone's Settings says of its pushes, as pure decisions: the "Notify me" choices and what each means, and how its pushes are faring in a few words.
 *
 * The phone's standing comes from the service (`push-device-wire.ts`): its
 * "Notify me", when a push to it last reached Apple, and, while its pushes
 * fail, since when and Apple's reason. A failing run is said first, with
 * its start and its reason, since it is what a person must see; a phone a
 * push has reached says it is working; one no push has reached yet says so.
 * Nothing here draws.
 */

import { PRODUCT_NAME } from "./product-name.js";
import { PUSH_NOTIFY, type PushDeviceStatusAnswer, type PushNotify } from "./push-device-wire.js";
import { dayAndTimeText } from "./time-format.js";

/** Each "Notify me" choice in the order Settings lists them, with its label. */
export const PUSH_NOTIFY_CHOICES: readonly { readonly id: PushNotify; readonly label: string }[] = [
  { id: PUSH_NOTIFY.AWAY, label: "When I'm away" },
  { id: PUSH_NOTIFY.ALWAYS, label: "Always" },
  { id: PUSH_NOTIFY.NEVER, label: "Never" },
];

/** What the choices mean, under them. */
export const PUSH_NOTIFY_FOOTER = `When I'm away holds a notification while you're using ${PRODUCT_NAME} on a computer, and sends it if you step away with it still waiting.`;

/** What the phone says when the service did not take a "Notify me" choice, which is put back. */
export const PUSH_NOTIFY_REFUSED = "Notify me could not be changed. Try again.";

/** How a phone's pushes stand where none failed: working, or none sent yet. */
const PUSH_STANDING_WORDS = {
  WORKING: "Working",
  NONE_YET: "None sent yet",
} as const;

/** How the phone's pushes are faring, as the Notifications row says it: failing since when and why, working, or none sent yet. */
export function pushStandingText(
  standing: Pick<PushDeviceStatusAnswer, "lastDeliveredAt" | "failingSince" | "failureReason">,
): string {
  if (standing.failingSince !== null) {
    const since = `Failing since ${dayAndTimeText(standing.failingSince)}`;
    return standing.failureReason === null ? since : `${since} (${standing.failureReason})`;
  }
  return standing.lastDeliveredAt === null
    ? PUSH_STANDING_WORDS.NONE_YET
    : PUSH_STANDING_WORDS.WORKING;
}

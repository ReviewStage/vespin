import { CARRY_ON_REASON, type CarryOnReason } from "@repo/wire";
import { PRODUCT_NAME } from "./product-name.js";

/**
 * carry-on-words.ts -- what the transcript says where a turn was cut off and carried on by itself: one line per reason the carry-on line names.
 *
 * A turn cut off before it ended, by its runner going away or by the
 * connection to the model's provider dropping, is carried on by a line the
 * service sends the agent (`@repo/wire`'s `MESSAGE_CHANNEL.CARRY_ON`), and
 * the window draws that line as what happened rather than as the failure
 * it mends, so the transcript reads that we stopped on the Mac and it carried on
 * by itself where it happened. The Mac's line names us stopping there
 * rather than how, since a quit, a crash, and a reboot all settle
 * the same way. The words are read off the
 * line's reason alone, so the service and the window share one table, and
 * a reason this build has no words for reads as the one it comes closest
 * to: a runner gone.
 */

/** What the transcript's line says of each reason: what cut the turn off, then that it went on by itself. */
const CARRY_ON_LINE_WORDS = {
  [CARRY_ON_REASON.HOST_RESTART]: `Interrupted when ${PRODUCT_NAME} stopped on the Mac · carried on by itself`,
  [CARRY_ON_REASON.RUNNER_LOST]: "Interrupted when the sandbox stopped · carried on by itself",
  [CARRY_ON_REASON.CONNECTION_LOST]:
    "Lost the connection to the provider · carried on when it came back",
} as const satisfies Record<CarryOnReason, string>;

/** The transcript's line for a carry-on, by the reason its line names. */
export function carryOnLineWords(reason: CarryOnReason): string {
  return CARRY_ON_LINE_WORDS[reason];
}

/**
 * started-turns.ts -- what hears of each coding agent turn the store writer starts running: the Live Activity of its member's phones.
 *
 * The writer tells its `StartedTurnListener` once the start's transaction is
 * done (`@repo/database/models/writer`), and the runner's events route tells
 * it once its batch commits (`../native-events/runner-events-app.ts`). This
 * is the one listener the deployment provides (`../../runtime.ts`): it
 * refreshes the Live Activity of the member whose agent began the turn, which
 * push-to-starts one where none stands (`../../push/live-activities.ts`),
 * once the request has answered and on the pool rather than on a transaction
 * the start may have run inside, as `settled-turns.ts` pushes.
 */

import { StartedTurnListener } from "@repo/database/models/writer";
import { Effect, Layer, Option } from "effect";
import { afterResponse } from "../../http/after-response.js";
import { ApnsSender } from "../../push/apns.js";
import { LIVE_ACTIVITY_CAUSE, refreshLiveActivity } from "../../push/live-activities.js";
import { outsideTransaction } from "./settled-turns.js";

/** The deployment's listener over its APNs sender, read optionally as the layer is built, so a runtime without one pushes nothing. */
export const startedTurnListener: Layer.Layer<StartedTurnListener> = Layer.effect(
  StartedTurnListener,
  Effect.gen(function* () {
    const apns = yield* Effect.serviceOption(ApnsSender);
    return {
      heard: (turn) =>
        Option.match(apns, {
          onNone: () => Effect.void,
          onSome: (sender) =>
            afterResponse(
              "a started turn's live activity",
              outsideTransaction(
                refreshLiveActivity(turn.userId, LIVE_ACTIVITY_CAUSE.ROUTINE).pipe(
                  Effect.provideService(ApnsSender, sender),
                ),
              ),
            ),
        }),
    };
  }),
);

/**
 * use-live-activity.ts -- the app's side of the Live Activity of the member's running agents: a Stop pressed on it sent through the host, and, on a fixture run, an activity of the fixture's own.
 *
 * The service starts, updates, and ends the activity by push, and the
 * widget extension draws it (`live-activity/`), so the app's part is small.
 * A Stop pressed on an agent's row reaches the app's native module, which
 * hands it here; the host stops the agent as the agent page's Stop does, and
 * the request is answered whatever the host said, since the activity's next
 * push says how it went. A fixture run, which no push reaches, starts an
 * activity of the fixture's content state where its launch asks for one
 * (`-liveActivity true`, as `maestro/live-activity.yaml` launches), so a
 * flow can shoot the Dynamic Island and the Lock Screen, and ends any
 * activity otherwise, so none outlasts its flow.
 */

import {
  type LiveActivityContentState,
  liveActivityContentStateSchema,
} from "@repo/features/live-activity-wire";
import { ACT_KIND } from "@repo/host/acts";
import { Schema } from "effect";
import { useEffect } from "react";
import { useHostActs } from "../host/host-provider.js";
import { launchLiveActivity } from "../host/launch-arguments.js";
import { useFixtureRun } from "../push-device.js";
import { liveActivityModule } from "./live-activity-module.js";

/** How long ago each of the fixture's agents began its turn, so its timers read as a working afternoon. */
const FIXTURE_TURN_AGES = { REFRESH: 94_000, ACTIVITIES: 612_000, INVITES: 8_000 } as const;

/** The fixture's activity: three agents working and one ask waiting, the newest turn first, as of `now`. */
function fixtureContentState(now: number): LiveActivityContentState {
  return {
    running: 3,
    waiting: 1,
    agents: [
      {
        id: "fixture-live-activity-invites",
        title: "Resend expired invites",
        step: null,
        startedAt: now - FIXTURE_TURN_AGES.INVITES,
      },
      {
        id: "fixture-live-activity-refresh",
        title: "Fix the token refresh",
        step: "Editing session-store.ts",
        startedAt: now - FIXTURE_TURN_AGES.REFRESH,
      },
      {
        id: "fixture-live-activity-activities",
        title: "Add Live Activities",
        step: "Running the tests",
        startedAt: now - FIXTURE_TURN_AGES.ACTIVITIES,
      },
    ],
  };
}

/** The Live Activity's Stop sent through the host while an account is signed in, and a fixture run's own activity started or ended once a launch. */
export function useLiveActivity(signedIn: boolean): void {
  const acts = useHostActs();
  const fixture = useFixtureRun();
  useEffect(() => {
    if (liveActivityModule === null || !signedIn) return undefined;
    const module = liveActivityModule;
    const subscription = module.addListener("onStop", ({ request, agentId }) => {
      acts[ACT_KIND.AGENTS_STOP]({ agentId })
        .then((answer) => {
          if ("failure" in answer) console.error(`The stop was refused: ${answer.failure}.`);
        })
        .catch((error: unknown) => console.error("The stop did not go.", error))
        .finally(() => module.answerStop(request));
    });
    return () => subscription.remove();
  }, [acts, signedIn]);
  useEffect(() => {
    if (liveActivityModule === null || !fixture) return;
    // Note that the state is encoded through the service's own Schema, so the widget decodes the bytes a push would carry.
    const started = launchLiveActivity()
      ? liveActivityModule.startFixture(
          JSON.stringify(
            Schema.encodeSync(liveActivityContentStateSchema)(fixtureContentState(Date.now())),
          ),
        )
      : liveActivityModule.endAll();
    started.catch((error: unknown) =>
      console.error("The fixture's Live Activity was not started or ended.", error),
    );
  }, [fixture]);
}

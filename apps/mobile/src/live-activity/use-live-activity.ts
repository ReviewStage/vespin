/**
 * use-live-activity.ts -- the app's side of the Live Activity of the member's running agents: its tokens and its end told to the service, a Stop pressed on it sent through the host, and, on a fixture run, an activity of the fixture's own.
 *
 * The service starts, updates, and ends the activity by push, and the
 * widget extension draws it (`live-activity/`), so the app's part is small.
 * The service pushes to two tokens ActivityKit hands the phone: its
 * push-to-start token, and the update token of the activity standing. Each
 * is sent through the host once the account signed in holds the phone
 * (`registeredPushDevice`), since the service names the phone by its APNs
 * token, and the latest of each again on every launch, since iOS may hand a
 * new one; an activity ended or dismissed on the phone is told too, so the
 * service push-to-starts a fresh one next time, and a sign-out ends it on
 * the phone. A Stop pressed on an agent's row reaches the app's native module, which
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
import { useEffect, useRef, useState } from "react";
import { useHostActs } from "../host/host-provider.js";
import { launchLiveActivity } from "../host/launch-arguments.js";
import { registeredPushDevice, useFixtureRun, usePushDeviceKey } from "../push-device.js";
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

/** Logs what the service did not take of a token or an end; the next launch tells it again. */
function logRefusal(answer: { readonly failure: string } | { readonly done: true }): void {
  if ("failure" in answer)
    console.error(`The service did not take the Live Activity's change: ${answer.failure}.`);
}

/** The latest push-to-start token and activity token ActivityKit handed this launch, the activity's none once it ends, and how many activities ended. */
function useActivityTokens(): {
  readonly start: string | undefined;
  readonly activity: string | undefined;
  readonly ended: number;
} {
  const [start, setStart] = useState<string | undefined>(undefined);
  const [activity, setActivity] = useState<string | undefined>(undefined);
  const [ended, setEnded] = useState(0);
  useEffect(() => {
    if (liveActivityModule === null) return undefined;
    const subscriptions = [
      liveActivityModule.addListener("onStartToken", ({ token }) => setStart(token)),
      liveActivityModule.addListener("onActivityToken", ({ token }) => setActivity(token)),
      liveActivityModule.addListener("onActivityEnded", () => {
        setActivity(undefined);
        setEnded((count) => count + 1);
      }),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);
  return { start, activity, ended };
}

/** The Live Activity's tokens and end told to the service and its Stop sent through the host while an account is signed in, and a fixture run's own activity started or ended once a launch. */
export function useLiveActivity(signedIn: boolean): void {
  const acts = useHostActs();
  const fixture = useFixtureRun();
  const key = usePushDeviceKey();
  const { start, activity, ended } = useActivityTokens();
  // The phone each token is sent beside, once an account is signed in and iOS has handed its APNs token.
  const phone = signedIn ? key : undefined;
  useEffect(() => {
    if (phone === undefined || start === undefined) return;
    registeredPushDevice(acts, phone)
      .then(() =>
        acts[ACT_KIND.LIVE_ACTIVITY_START_TOKEN]({
          deviceToken: phone.token,
          environment: phone.environment,
          token: start,
        }),
      )
      .then(logRefusal, (error: unknown) =>
        console.error("The Live Activity's push-to-start token was not sent.", error),
      );
  }, [acts, phone, start]);
  // The count of ends the service has taken, so a change of phone never tells one again and clears the token of an activity standing since.
  const told = useRef(0);
  useEffect(() => {
    if (phone === undefined || activity === undefined) return;
    // Note that an end not yet taken is dropped once a newer activity's token is sent, which replaces the ended one's on the service, so no late retry clears it.
    told.current = ended;
    registeredPushDevice(acts, phone)
      .then(() =>
        acts[ACT_KIND.LIVE_ACTIVITY_TOKEN]({
          deviceToken: phone.token,
          environment: phone.environment,
          token: activity,
        }),
      )
      .then(logRefusal, (error: unknown) =>
        console.error("The Live Activity's token was not sent.", error),
      );
    // Note that `ended` is read, not followed, so the token is sent once for each activity, not again as ends are counted.
  }, [acts, phone, activity]);
  useEffect(() => {
    if (phone === undefined || ended === told.current) return;
    // Note that an end is counted only once the service takes it, so one the host could not deliver is told again on the phone's next change.
    acts[ACT_KIND.LIVE_ACTIVITY_ENDED]({
      deviceToken: phone.token,
      environment: phone.environment,
    }).then(
      (answer) => {
        logRefusal(answer);
        if (!("failure" in answer)) told.current = Math.max(told.current, ended);
      },
      (error: unknown) => console.error("The Live Activity's end was not told.", error),
    );
  }, [acts, phone, ended]);
  // Whether an account was signed in at the last render, so a sign-out is told from a launch still reading the account.
  const wasSignedIn = useRef(false);
  useEffect(() => {
    // Note that a sign-out ends the activity on the phone, so none of the account's agents stay on the Lock Screen with a Stop nothing answers.
    if (wasSignedIn.current && !signedIn)
      liveActivityModule
        ?.endAll()
        .catch((error: unknown) => console.error("The Live Activity was not ended.", error));
    wasSignedIn.current = signedIn;
  }, [signedIn]);
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

/**
 * live-activities.ts -- the one Live Activity a member's phone shows for every agent of theirs that runs: push-to-started when their first agent begins a turn, updated as their agents and asks change, and ended once none runs.
 *
 * One activity stands per member per phone (`@repo/features/live-activity-wire`).
 * Whatever changed, the member's activity is refreshed whole
 * (`refreshLiveActivity`): its content state is read afresh, how many of
 * their own unarchived agents have a turn running, how many threads wait on
 * them as their badge counts them (`inboxWaitingCount`), and up to three of
 * the running agents, the newest turn first, each with its name, the step
 * line its running turn's journal last wrote, and when the turn started.
 * Each phone that registered its tokens is then pushed what it lacks: a
 * push-to-start to its push-to-start token where agents run and no activity
 * stands, an update to the standing activity's token where its state moved,
 * and an end, with a dismissal date, once no agent runs. A phone set to
 * never take a push takes none of these.
 *
 * What refreshes it: a turn of the member's agent starting (`StartedTurnListener`,
 * `../agents/coder-host/started-turns.ts`) and settling (`settled-turns.ts`),
 * a post or an ask on a thread that waits on them and the thread settling
 * (`inbox-pushes.ts`), and the scheduled sweep once a minute for every
 * member with an activity standing (`refreshLiveActivities`), which carries
 * a running agent's newest step line and sends what the throttle held back.
 *
 * Apple budgets an app's Live Activity pushes, so only a start, an end, and
 * an ask starting to wait on the member go at high priority
 * (`LIVE_ACTIVITY_CAUSE.ASKED`); every other update goes at low priority, at
 * most once per `LIVE_ACTIVITY_PUSH.THROTTLE` to a phone, and none whose
 * state the phone already shows. Each start and update carries a
 * `stale-date`, so an activity no push reached for a while ages gracefully
 * on the lock screen. The start says the newest agent's name in an alert,
 * as a push-to-start must, with no sound; nothing else alerts, and none of
 * it waits on the member's desk presence (`inbox-pushes.ts`'s hold), since
 * an activity that starts late is no activity: a failed run's own alert
 * still follows the hold.
 *
 * A token Apple says is gone is forgotten (`forgetLiveActivityToken`), and
 * an activity's update token is forgotten once the service ends it or iOS
 * would have (`LIVE_ACTIVITY_PUSH.LIFETIME`), so the next turn starts a
 * fresh one. Every push is the caller's best effort: a runtime with no
 * `ApnsSender`, or a member with no phone registered for an activity, pushes
 * nothing and reads nothing more.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { readAgent } from "@repo/database/models/agent-store";
import {
  forgetLiveActivityToken,
  LIVE_ACTIVITY_TOKEN,
  type LiveActivityPhone,
  listLiveActivityMembers,
  listLiveActivityPhones,
  listRunningAgentTurns,
  type RunningAgentTurn,
  recordLiveActivityEnded,
  recordLiveActivityPushed,
} from "@repo/database/models/live-activity-store";
import { newestJournalsOfReached } from "@repo/database/models/message-reads";
import {
  LIVE_ACTIVITY_ATTRIBUTES_TYPE,
  LIVE_ACTIVITY_BOUNDS,
  type LiveActivityAgent,
  type LiveActivityContentState,
} from "@repo/features/live-activity-wire";
import { agentName } from "@repo/features/model-label";
import { plainWords } from "@repo/features/plain-words";
import { PUSH_NOTIFY } from "@repo/features/push-device-wire";
import { toolCallView } from "@repo/features/tool-call-model";
import { callLine } from "@repo/features/turn-rows";
import type { WireValue } from "@repo/wire";
import {
  isStoredToolPart,
  type StoredToolPart,
  type StoredUIMessage,
  storedToolName,
} from "@repo/wire/ui-messages";
import { isTextUIPart } from "ai";
import { Clock, Duration, Effect, Option } from "effect";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { inboxWaitingCount } from "../inbox/inbox-store.js";
import {
  APNS_DELIVERY,
  APNS_LIVE_ACTIVITY_EVENT,
  APNS_PRIORITY,
  APNS_PUSH_TYPE,
  type ApnsDelivery,
  type ApnsPayload,
  type ApnsPriority,
  ApnsSender,
} from "./apns.js";

/** Why a member's activity is refreshed, which says how soon Apple delivers its update. */
export const LIVE_ACTIVITY_CAUSE = {
  /** Their agents or threads changed, or the sweep came round: a low-priority update, throttled. */
  ROUTINE: "routine",
  /** An ask started waiting on them: a high-priority update, never throttled. */
  ASKED: "asked",
} as const;

export type LiveActivityCause = (typeof LIVE_ACTIVITY_CAUSE)[keyof typeof LIVE_ACTIVITY_CAUSE];

export const LIVE_ACTIVITY_PUSH = {
  /** The least time between two routine updates to one phone; what it holds back the sweep sends. */
  THROTTLE: Duration.seconds(30),
  /** How long after a push its content counts as current, unless a later push says otherwise. */
  STALE_AFTER: Duration.minutes(15),
  /** How long an ended activity stays on the lock screen. */
  DISMISS_AFTER: Duration.minutes(10),
  /** How long iOS lets an activity stand before it ends it itself. */
  LIFETIME: Duration.hours(8),
  /** The most members one sweep refreshes, and how many at once; the rest wait for the next minute's. */
  SWEEP_BATCH: 200,
  SWEEP_CONCURRENCY: 8,
} as const;

/** What the start's alert says under the newest agent's name. */
const START_ALERT_BODY = "Started working.";

/** Words clipped to a bound, with an ellipsis where they were cut. */
function clipped(words: string, bound: number): string {
  return words.length <= bound ? words : `${words.slice(0, bound - 1).trimEnd()}…`;
}

/** An instant in the seconds since the epoch Apple reads. */
function epochSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/** A call said as its row's line says it, a file by its name alone: "Edited session-store.ts", "Ran pnpm test". */
function callStep(part: StoredToolPart): string {
  // SAFETY: a stored part's input is the JSON the row carried, which the call's view reads as wire.
  const input = part.input as WireValue;
  const view = toolCallView({ tool: storedToolName(part), input, output: undefined });
  const file = view.files?.[0];
  const subject = file === undefined ? view.subject : file.slice(file.lastIndexOf("/") + 1);
  const line = callLine(view.kind, subject, view.description);
  return line.subject === undefined || line.subject === ""
    ? line.verb
    : `${line.verb} ${line.subject}`;
}

/** The step line a running turn's journal last wrote: its last call, or its last words on one line; none before either. */
function stepOf(journal: StoredUIMessage): string | null {
  for (const part of [...journal.parts].reverse()) {
    if (isStoredToolPart(part)) return clipped(callStep(part), LIVE_ACTIVITY_BOUNDS.MAX_STEP_CHARS);
    if (isTextUIPart(part) && part.text.trim() !== "") {
      return clipped(plainWords(part.text), LIVE_ACTIVITY_BOUNDS.MAX_STEP_CHARS);
    }
  }
  return null;
}

/** The running agents the activity lists, the newest turn first, each named with its step line; an agent gone meanwhile is left out. */
function listedAgents(userId: string, running: readonly RunningAgentTurn[]) {
  return Effect.gen(function* () {
    const shown = running.slice(0, LIVE_ACTIVITY_BOUNDS.MAX_AGENTS);
    // Note that the journals are read by conversations of the member's own agents alone, which the query above admitted.
    const journals = yield* newestJournalsOfReached(
      shown.map((each) => each.conversationId),
      CODER_TOOL_SET,
    );
    const listed = yield* Effect.forEach(shown, (turn) =>
      Effect.map(
        readAgent(userId, turn.agentId),
        Option.map((agent): LiveActivityAgent => {
          const journal = journals.get(turn.conversationId);
          return {
            id: agent.id,
            title: clipped(agentName(agent), LIVE_ACTIVITY_BOUNDS.MAX_TITLE_CHARS),
            step: journal?.turnId === turn.turnId ? stepOf(journal.message) : null,
            startedAt: turn.startedAt.getTime(),
          };
        }),
      ),
    );
    return listed.flatMap((each) => (Option.isSome(each) ? [each.value] : []));
  });
}

/** The member's activity as it now stands: how many agents run, how many threads wait on them, and the newest of the running agents. */
function contentStateOf(
  userId: string,
  now: number,
): Effect.Effect<LiveActivityContentState, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const running = yield* listRunningAgentTurns(userId);
    return {
      running: running.length,
      waiting: yield* inboxWaitingCount(userId, now),
      agents: running.length === 0 ? [] : yield* listedAgents(userId, running),
    };
  });
}

/** The push-to-start: the activity's type and its state, with the alert Apple asks a start for, silent. */
function startPayload(state: LiveActivityContentState, now: number): ApnsPayload {
  return {
    aps: {
      timestamp: epochSeconds(now),
      event: APNS_LIVE_ACTIVITY_EVENT.START,
      "attributes-type": LIVE_ACTIVITY_ATTRIBUTES_TYPE,
      attributes: {},
      "content-state": state,
      "stale-date": epochSeconds(now + Duration.toMillis(LIVE_ACTIVITY_PUSH.STALE_AFTER)),
      alert: { title: state.agents[0]?.title ?? "Your agents", body: START_ALERT_BODY },
    },
  };
}

function updatePayload(state: LiveActivityContentState, now: number): ApnsPayload {
  return {
    aps: {
      timestamp: epochSeconds(now),
      event: APNS_LIVE_ACTIVITY_EVENT.UPDATE,
      "content-state": state,
      "stale-date": epochSeconds(now + Duration.toMillis(LIVE_ACTIVITY_PUSH.STALE_AFTER)),
    },
  };
}

function endPayload(state: LiveActivityContentState, now: number): ApnsPayload {
  return {
    aps: {
      timestamp: epochSeconds(now),
      event: APNS_LIVE_ACTIVITY_EVENT.END,
      "content-state": state,
      "dismissal-date": epochSeconds(now + Duration.toMillis(LIVE_ACTIVITY_PUSH.DISMISS_AFTER)),
    },
  };
}

/** One phone's activity brought to the member's state: started, updated, ended, or left as it is. */
function refreshPhone(
  userId: string,
  phone: LiveActivityPhone,
  state: LiveActivityContentState,
  cause: LiveActivityCause,
  now: number,
): Effect.Effect<void, StoreFailure, DatabaseServices | ApnsSender> {
  return Effect.gen(function* () {
    const sender = yield* ApnsSender;
    const { pushDeviceId } = phone;
    const send = (token: string, payload: ApnsPayload, priority: ApnsPriority) =>
      sender.send({
        device: { token, environment: phone.environment, bundleId: phone.bundleId },
        pushType: APNS_PUSH_TYPE.LIVE_ACTIVITY,
        payload,
        priority,
        // Note that Apple keeps the push for a phone that is off until its content would be stale anyway.
        expiration: epochSeconds(now + Duration.toMillis(LIVE_ACTIVITY_PUSH.STALE_AFTER)),
      });
    const sentState = JSON.stringify(state);
    const pushed = (delivery: ApnsDelivery, started: boolean) =>
      delivery === APNS_DELIVERY.DELIVERED
        ? recordLiveActivityPushed(userId, pushDeviceId, { sentState, started })
        : Effect.void;

    // An activity past the lifetime iOS gives one has ended on the phone, whatever we last heard.
    const aged =
      phone.startedAt !== null &&
      now - phone.startedAt.getTime() >= Duration.toMillis(LIVE_ACTIVITY_PUSH.LIFETIME);
    if (aged) yield* recordLiveActivityEnded(userId, pushDeviceId);
    const standing = phone.startedAt !== null && !aged;

    if (state.running === 0) {
      if (!standing) return;
      if (phone.activityToken !== null) {
        yield* send(phone.activityToken, endPayload(state, now), APNS_PRIORITY.IMMEDIATE);
      }
      // Note that the activity is ended here whatever Apple answered, so a token gone or a push lost never holds back the next start.
      return yield* recordLiveActivityEnded(userId, pushDeviceId);
    }
    if (!standing) {
      if (phone.startToken === null) return;
      const delivery = yield* send(
        phone.startToken,
        startPayload(state, now),
        APNS_PRIORITY.IMMEDIATE,
      );
      if (delivery === APNS_DELIVERY.TOKEN_GONE) {
        return yield* forgetLiveActivityToken(userId, pushDeviceId, LIVE_ACTIVITY_TOKEN.START);
      }
      return yield* pushed(delivery, true);
    }
    // An activity whose update token the app has not registered yet takes nothing until it has.
    if (phone.activityToken === null || sentState === phone.sentState) return;
    const asked = cause === LIVE_ACTIVITY_CAUSE.ASKED;
    const throttled =
      phone.sentAt !== null &&
      now - phone.sentAt.getTime() < Duration.toMillis(LIVE_ACTIVITY_PUSH.THROTTLE);
    if (!asked && throttled) return;
    const delivery = yield* send(
      phone.activityToken,
      updatePayload(state, now),
      asked ? APNS_PRIORITY.IMMEDIATE : APNS_PRIORITY.CONSERVE_POWER,
    );
    if (delivery === APNS_DELIVERY.TOKEN_GONE) {
      return yield* forgetLiveActivityToken(userId, pushDeviceId, LIVE_ACTIVITY_TOKEN.ACTIVITY);
    }
    yield* pushed(delivery, false);
  });
}

/**
 * Brings the member's activity on each of their phones to their state as it
 * now stands, as the header says; nothing where the runtime holds no sender
 * or the member registered no phone for an activity.
 */
export function refreshLiveActivity(
  userId: string,
  cause: LiveActivityCause,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const sender = yield* Effect.serviceOption(ApnsSender);
    if (Option.isNone(sender)) return;
    const phones = (yield* listLiveActivityPhones(userId)).filter(
      (phone) => phone.notify !== PUSH_NOTIFY.NEVER,
    );
    if (phones.length === 0) return;
    const now = yield* Clock.currentTimeMillis;
    const state = yield* contentStateOf(userId, now);
    yield* Effect.forEach(phones, (phone) => refreshPhone(userId, phone, state, cause, now), {
      discard: true,
    }).pipe(Effect.provideService(ApnsSender, sender.value));
  });
}

/**
 * The scheduled sweep's refresh: a batch of the members with an activity
 * standing on a phone, each refreshed as routine, so a running agent's step
 * line reaches it and an update the throttle held back goes; how many it
 * refreshed. A refresh that fails is logged and dropped, as the next
 * minute's tries again.
 */
export function refreshLiveActivities(): Effect.Effect<number, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const members = yield* listLiveActivityMembers(LIVE_ACTIVITY_PUSH.SWEEP_BATCH);
    yield* Effect.forEach(
      members,
      (userId) =>
        refreshLiveActivity(userId, LIVE_ACTIVITY_CAUSE.ROUTINE).pipe(
          Effect.catch((failure) =>
            Effect.logWarning("a live activity was not refreshed", failure),
          ),
        ),
      { concurrency: LIVE_ACTIVITY_PUSH.SWEEP_CONCURRENCY, discard: true },
    );
    return members.length;
  });
}

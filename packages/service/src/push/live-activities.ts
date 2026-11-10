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
 * and an end, with a dismissal date, once no agent runs.
 *
 * What refreshes it: a turn of the member's agent starting (`StartedTurnListener`,
 * `../agents/coder-host/started-turns.ts`) and settling (`settled-turns.ts`),
 * a post or an ask on a thread that waits on them and the thread settling
 * (`inbox-pushes.ts`), and the scheduled sweep once a minute for a batch of
 * the members with an activity standing (`refreshLiveActivities`), which
 * carries a running agent's newest step line, sends what the throttle held
 * back, and tries again a start or an end Apple did not take.
 *
 * Refreshes of one member run at once, often on different instances, so
 * none acts on what it read alone: a push-to-start is claimed in the store
 * before it is sent (`claimLiveActivityStart`), and only the refresh that
 * claimed it sends; a start Apple did not take keeps its claim unconfirmed,
 * which a refresh takes again once `LIVE_ACTIVITY_PUSH.START_HOLD` has
 * passed. An end reads again whether an agent runs before it is sent, is
 * forgotten only once Apple took it or no retry would help, and only where
 * the activity still stands as read; and once it is, a turn that began
 * meanwhile, whose own refresh read the activity standing, starts it again.
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
 * still follows the hold. A phone set to never take a push takes no start
 * or update, and an activity standing on it when it is set so is ended.
 *
 * A token Apple says is gone is forgotten (`forgetLiveActivityToken`), and
 * an activity's update token is forgotten once the service ends it or iOS
 * would have (`LIVE_ACTIVITY_PUSH.LIFETIME`), so the next turn starts a
 * fresh one; either is forgotten only where the phone still holds the one
 * that was sent to. Every push is the caller's best effort: a runtime with no
 * `ApnsSender`, or a member with no phone registered for an activity, pushes
 * nothing and reads nothing more.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { readAgent } from "@repo/database/models/agent-store";
import {
  claimLiveActivityStart,
  forgetLiveActivityToken,
  LIVE_ACTIVITY_TOKEN,
  type LiveActivityPhone,
  type LiveActivityRead,
  listLiveActivityMembers,
  listLiveActivityPhones,
  listRunningAgentTurns,
  type RunningAgentTurn,
  recordLiveActivityEnded,
  recordLiveActivityPushed,
  releaseLiveActivityStart,
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
import { causeKind } from "@repo/runtime/effect";
import type { WireValue } from "@repo/wire";
import {
  isStoredToolPart,
  type StoredToolPart,
  type StoredUIMessage,
  storedToolName,
} from "@repo/wire/ui-messages";
import { isTextUIPart } from "ai";
import { Cause, Clock, Duration, Effect, Option } from "effect";
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
  /** How long iOS lets an activity stand before it ends it itself, and so how long Apple keeps an end for a phone that is off. */
  LIFETIME: Duration.hours(8),
  /** How long a claimed push-to-start stands unconfirmed before a refresh takes it again: well past APNs' own timeout on the send (`APNS_REQUEST_TIMEOUT`). */
  START_HOLD: Duration.minutes(1),
  /** The most phones one sweep takes, and how many members at once; the rest wait for the next minute's. */
  SWEEP_BATCH: 200,
  SWEEP_CONCURRENCY: 8,
  /** How long one sweep takes new members, so APNs answering slowly never holds the sweeps after it. */
  SWEEP_BUDGET: Duration.seconds(60),
} as const;

/** How many of a journal's newest parts its step line is looked for in, so a long turn's whole journal is never read for its last line. */
const STEP_TAIL_PARTS = 16;

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
      STEP_TAIL_PARTS,
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

/**
 * Whether an activity stands on the phone as the refresh reads it: one
 * started inside its lifetime that the phone confirmed, by its update token
 * or by Apple taking the start, or a claimed start still inside its hold.
 */
function standsOn(phone: LiveActivityPhone, now: number): boolean {
  if (phone.startedAt === null) return false;
  const age = now - phone.startedAt.getTime();
  if (age >= Duration.toMillis(LIVE_ACTIVITY_PUSH.LIFETIME)) return false;
  const confirmed =
    phone.activityToken !== null ||
    (phone.sentAt !== null && phone.sentAt.getTime() >= phone.startedAt.getTime());
  return confirmed || age < Duration.toMillis(LIVE_ACTIVITY_PUSH.START_HOLD);
}

/** One push to the phone's activity, kept by Apple for a phone that is off until `expiresAfter` has passed. */
function sendTo(
  phone: LiveActivityPhone,
  token: string,
  payload: ApnsPayload,
  priority: ApnsPriority,
  expiresAfter: Duration.Duration,
  now: number,
): Effect.Effect<ApnsDelivery, never, DatabaseServices | ApnsSender> {
  return Effect.gen(function* () {
    const sender = yield* ApnsSender;
    return yield* sender.send({
      device: { token, environment: phone.environment, bundleId: phone.bundleId },
      pushType: APNS_PUSH_TYPE.LIVE_ACTIVITY,
      payload,
      priority,
      expiration: epochSeconds(now + Duration.toMillis(expiresAfter)),
    });
  });
}

/**
 * The phone's activity push-to-started where this refresh claims the start,
 * as the header says: Apple taking it confirms the claim, Apple not taking
 * it this time leaves the claim for a later refresh to take again, and a
 * gone token or a refusal lets it go.
 */
function startOn(
  userId: string,
  phone: LiveActivityPhone,
  read: LiveActivityRead,
  state: LiveActivityContentState,
  now: number,
): Effect.Effect<void, StoreFailure, DatabaseServices | ApnsSender> {
  const { pushDeviceId, startToken } = phone;
  if (startToken === null) return Effect.void;
  const claimedAt = new Date(now);
  // Note that the claim, the send, and its record run uninterrupted, so a sweep cut short never leaves a start Apple took unrecorded.
  return Effect.uninterruptible(
    Effect.gen(function* () {
      if (
        !(yield* claimLiveActivityStart(userId, pushDeviceId, { startToken, read, now: claimedAt }))
      ) {
        return;
      }
      const delivery = yield* sendTo(
        phone,
        startToken,
        startPayload(state, now),
        APNS_PRIORITY.IMMEDIATE,
        LIVE_ACTIVITY_PUSH.STALE_AFTER,
        now,
      );
      if (delivery === APNS_DELIVERY.DELIVERED) {
        const sentState = JSON.stringify(state);
        return yield* recordLiveActivityPushed(userId, pushDeviceId, {
          sentAt: claimedAt,
          sentState,
          startedAt: claimedAt,
        });
      }
      if (delivery === APNS_DELIVERY.FAILED) return;
      if (delivery === APNS_DELIVERY.TOKEN_GONE) {
        yield* forgetLiveActivityToken(userId, pushDeviceId, LIVE_ACTIVITY_TOKEN.START, startToken);
      }
      yield* releaseLiveActivityStart(userId, pushDeviceId, claimedAt);
    }),
  );
}

/**
 * The phone's standing activity ended, as the header says: not while an
 * agent runs, unless the phone is set to never take a push; forgotten once
 * Apple took the end or no retry would help, and left standing for the
 * sweep to try again where Apple did not take it this time; and started
 * again where a turn began while it ended.
 */
function endOn(
  userId: string,
  phone: LiveActivityPhone,
  read: LiveActivityRead,
  state: LiveActivityContentState,
  now: number,
): Effect.Effect<void, StoreFailure, DatabaseServices | ApnsSender> {
  return Effect.gen(function* () {
    const never = phone.notify === PUSH_NOTIFY.NEVER;
    // Note that whether an agent runs is read again here, as a turn may have begun since the state was read.
    if (!never && (yield* listRunningAgentTurns(userId)).length > 0) return;
    if (phone.activityToken !== null) {
      const delivery = yield* sendTo(
        phone,
        phone.activityToken,
        endPayload(state, now),
        APNS_PRIORITY.IMMEDIATE,
        LIVE_ACTIVITY_PUSH.LIFETIME,
        now,
      );
      if (delivery === APNS_DELIVERY.FAILED) return;
    }
    const ended = yield* recordLiveActivityEnded(userId, phone.pushDeviceId, read);
    if (!ended || never) return;
    // Note that a turn that began while the end was in flight read the activity standing and left it be, so it is started again here.
    const restartAt = yield* Clock.currentTimeMillis;
    const restart = yield* contentStateOf(userId, restartAt);
    if (restart.running === 0) return;
    const cleared = { startedAt: null, activityToken: null };
    yield* startOn(userId, { ...phone, ...cleared, sentState: null }, cleared, restart, restartAt);
  });
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
    const { pushDeviceId } = phone;
    const read = { startedAt: phone.startedAt, activityToken: phone.activityToken };
    const wanted = state.running > 0 && phone.notify !== PUSH_NOTIFY.NEVER;

    if (!standsOn(phone, now)) {
      if (wanted) return yield* startOn(userId, phone, read, state, now);
      // An activity aged out, or a start no refresh confirmed, is let go once none is wanted.
      if (phone.startedAt !== null) yield* recordLiveActivityEnded(userId, pushDeviceId, read);
      return;
    }
    if (!wanted) return yield* endOn(userId, phone, read, state, now);
    // An activity whose update token the app has not registered yet takes nothing until it has.
    const sentState = JSON.stringify(state);
    if (phone.startedAt === null || phone.activityToken === null || sentState === phone.sentState) {
      return;
    }
    const asked = cause === LIVE_ACTIVITY_CAUSE.ASKED;
    const throttled =
      phone.sentAt !== null &&
      now - phone.sentAt.getTime() < Duration.toMillis(LIVE_ACTIVITY_PUSH.THROTTLE);
    if (!asked && throttled) return;
    const delivery = yield* sendTo(
      phone,
      phone.activityToken,
      updatePayload(state, now),
      asked ? APNS_PRIORITY.IMMEDIATE : APNS_PRIORITY.CONSERVE_POWER,
      LIVE_ACTIVITY_PUSH.STALE_AFTER,
      now,
    );
    if (delivery === APNS_DELIVERY.TOKEN_GONE) {
      return yield* forgetLiveActivityToken(
        userId,
        pushDeviceId,
        LIVE_ACTIVITY_TOKEN.ACTIVITY,
        phone.activityToken,
      );
    }
    if (delivery !== APNS_DELIVERY.DELIVERED) return;
    yield* recordLiveActivityPushed(userId, pushDeviceId, {
      sentAt: new Date(now),
      sentState,
      startedAt: phone.startedAt,
    });
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
    // Note that a phone set to never take a push is still read while an activity stands on it, so that activity is ended.
    const phones = (yield* listLiveActivityPhones(userId)).filter(
      (phone) => phone.notify !== PUSH_NOTIFY.NEVER || phone.startedAt !== null,
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
 * standing on a phone, the longest unswept first, each refreshed as
 * routine, so a running agent's step line reaches it, an update the
 * throttle held back goes, and a start or an end Apple did not take is
 * tried again; how many members it took. A member is taken only while
 * `LIVE_ACTIVITY_PUSH.SWEEP_BUDGET` lasts, and a refresh that fails or dies
 * is logged and dropped, as the next minute's tries again.
 */
export function refreshLiveActivities(): Effect.Effect<number, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const members = yield* listLiveActivityMembers(LIVE_ACTIVITY_PUSH.SWEEP_BATCH);
    const until =
      (yield* Clock.currentTimeMillis) + Duration.toMillis(LIVE_ACTIVITY_PUSH.SWEEP_BUDGET);
    const refreshed = (userId: string) =>
      Effect.gen(function* () {
        if ((yield* Clock.currentTimeMillis) >= until) return;
        yield* refreshLiveActivity(userId, LIVE_ACTIVITY_CAUSE.ROUTINE);
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning(`a live activity was not refreshed: ${causeKind(cause)}`),
        ),
      );
    yield* Effect.forEach(members, refreshed, {
      concurrency: LIVE_ACTIVITY_PUSH.SWEEP_CONCURRENCY,
      discard: true,
    });
    return members.length;
  });
}

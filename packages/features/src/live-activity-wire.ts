/**
 * live-activity-wire.ts -- the one Live Activity a member's phone shows for every agent of theirs that runs, as the service pushes it and the iOS app's widget draws it: its type, its content state, and the tokens the app registers for it.
 *
 * One activity stands per member per phone. The service push-to-starts it
 * when the member's first agent begins a turn, updates it as their agents
 * start and settle turns, as a running agent's step line changes, and as an
 * ask starts or stops waiting on them, and ends it, with a dismissal date,
 * once none of their agents runs (`@repo/service/push/live-activities`).
 * ActivityKit decodes `aps.content-state` into the widget's Swift
 * `ContentState`, so the keys here are the Swift's, exactly: a key renamed
 * here is a widget that stops decoding. An instant travels as epoch
 * milliseconds in a JSON number, never a date, since ActivityKit decodes a
 * Swift `Date` as seconds since 2001; the widget converts it itself.
 *
 * The app registers two tokens per phone, each beside the phone's APNs
 * device token and gateway as `push-device-wire.ts` registers them, which
 * name the phone the account already holds: the push-to-start token
 * ActivityKit hands it for the activity's type, and the update token of the
 * one activity that stands, which it says is gone once the activity ends on
 * the phone. Each token is hex, as a device token is, and travels in a
 * request's body alone, never its address.
 */

import { Schema as EffectSchema } from "effect";
import { pushDeviceTokenSchema, pushEnvironmentSchema } from "./push-device-wire.js";

/** The activity's type as the widget's Swift names it, which a push-to-start's `attributes-type` says; its `attributes` are empty, since one activity covers every running agent. */
export const LIVE_ACTIVITY_ATTRIBUTES_TYPE = "AgentsActivityAttributes";

export const LIVE_ACTIVITY_BOUNDS = {
  /** The most characters of an agent's id: a UUID, with room to spare. */
  MAX_ID_CHARS: 64,
  /** The most running agents the content state lists. */
  MAX_AGENTS: 3,
  /** The most characters of an agent's title the content state carries; Apple caps a Live Activity's payload at 4 KB. */
  MAX_TITLE_CHARS: 80,
  /** The most characters of a step line the content state carries. */
  MAX_STEP_CHARS: 120,
} as const;

/** One running agent as the activity lists it. */
export const liveActivityAgentSchema = EffectSchema.Struct({
  /** The agent's id, which a tap on its row opens. */
  id: EffectSchema.NonEmptyString.check(
    EffectSchema.isMaxLength(LIVE_ACTIVITY_BOUNDS.MAX_ID_CHARS),
  ),
  title: EffectSchema.String.check(EffectSchema.isMaxLength(LIVE_ACTIVITY_BOUNDS.MAX_TITLE_CHARS)),
  /** The agent's current step line on one line, such as "Editing session-store.ts"; null before its first step. */
  step: EffectSchema.NullOr(
    EffectSchema.String.check(EffectSchema.isMaxLength(LIVE_ACTIVITY_BOUNDS.MAX_STEP_CHARS)),
  ),
  /** When its running turn started, in epoch milliseconds, from which the widget counts the time elapsed. */
  startedAt: EffectSchema.Number.check(EffectSchema.isGreaterThanOrEqualTo(0)),
});

export type LiveActivityAgent = typeof liveActivityAgentSchema.Type;

/**
 * The activity's content state: how many of the member's agents run, how
 * many asks wait on them, and up to `LIVE_ACTIVITY_BOUNDS.MAX_AGENTS` of
 * the running agents, the newest turn first. The end's state runs none and
 * lists none; the widget says it is done on its own.
 */
export const liveActivityContentStateSchema = EffectSchema.Struct({
  running: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
  waiting: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0)),
  agents: EffectSchema.Array(liveActivityAgentSchema).check(
    EffectSchema.isMaxLength(LIVE_ACTIVITY_BOUNDS.MAX_AGENTS),
  ),
});

export type LiveActivityContentState = typeof liveActivityContentStateSchema.Type;

/** A token registered for the phone's activity: the phone, by its device token and gateway, and the token ActivityKit handed it. */
export const liveActivityTokenRequestSchema = EffectSchema.Struct({
  deviceToken: pushDeviceTokenSchema,
  environment: pushEnvironmentSchema,
  token: pushDeviceTokenSchema,
});

export type LiveActivityTokenRequest = typeof liveActivityTokenRequestSchema.Type;

/** The phone's activity ended on the phone, its update token gone with it: the phone, by its device token and gateway. */
export const liveActivityEndedRequestSchema = EffectSchema.Struct({
  deviceToken: pushDeviceTokenSchema,
  environment: pushEnvironmentSchema,
});

export type LiveActivityEndedRequest = typeof liveActivityEndedRequestSchema.Type;

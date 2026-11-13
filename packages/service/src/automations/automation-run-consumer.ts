/**
 * automation-run-consumer.ts -- the automation-runs queue's consumer: a firing delivered, recorded once under its dedupe key, and its run started.
 *
 * Two kinds of message come on `AUTOMATION_RUNS.TOPIC`: a schedule's, which
 * Vercel Schedules publishes each time an automation's cron is due
 * (`automation-cadence.ts` keeps the schedule), and a firing a webhook's
 * call, a GitHub delivery, or an integration's event published. A
 * schedule's is read as a firing of the automation it names, keyed by the
 * occurrence's `executionId`, which every delivery of it carries. Every
 * firing is recorded under its dedupe key, so a delivery sent again finds
 * it recorded, and a run still queued is acted on (`automation-runs.ts`).
 * A one-time schedule's automation is then paused for having run, never
 * deleted, so its run and the agent it started stay readable; one whose
 * date was moved on since it fired is left to run again. Its spent Vercel
 * schedule is left for the next save to delete or make anew
 * (`automation-cadence.ts`), because deleting it here could delete one an
 * edit made beside this delivery.
 * A delivery that fails is left unacknowledged, and the queue delivers it
 * again; its effect is run through the queues' one promise door
 * (`../queues/queue-consumer.ts`).
 */

import {
  type Automation,
  advanceAutomationSchedule,
  automationRunToAct,
  pauseSpentAutomation,
} from "@repo/database/models/automation-store";
import { nextScheduledRun, onceInstant } from "@repo/features/automation-schedule";
import {
  AUTOMATION_FIRING,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
  scheduleRunsOnce,
} from "@repo/features/automation-wire";
import { failureKind } from "@repo/runtime/effect";
import type { WireValue } from "@repo/wire";
import { Clock, type Context, Effect, Option, Schema } from "effect";
import { routedSessions } from "../agents/coder-host/runtime-sessions.js";
import type { StartServices } from "../agents/coder-host/start.js";
import { QUEUE_ACKNOWLEDGED, queueConsumer } from "../queues/queue-consumer.js";
import {
  type AutomationFiringMessage,
  automationFiringMessageSchema,
  recordFiring,
} from "./automation-cadence.js";
import { actOnAutomationRun, type SessionsForAccount } from "./automation-runs.js";

/** A schedule's message as Vercel Schedules publishes it: the occurrence, and the schedule by its automation's id. */
const scheduleMessageSchema = Schema.Struct({
  executionId: Schema.String,
  name: Schema.String,
  scheduledAt: Schema.String,
});

type ScheduleMessage = typeof scheduleMessageSchema.Type;

const decodeDelivered = Schema.decodeUnknownEffect(
  Schema.Union([automationFiringMessageSchema, scheduleMessageSchema]),
);

/** The schedule's occurrence as a firing of the automation it names. */
function scheduledFiring(message: ScheduleMessage, now: number): AutomationFiringMessage {
  return {
    automationId: message.name,
    dedupeKey: message.executionId,
    firing: { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: Date.parse(message.scheduledAt) },
    firedAt: now,
  };
}

/** The date and time of the automation's one-time schedule where the occurrence due at `dueAt` is its run, its instant come by then; nothing for any other. */
function spentAt(automation: Automation, dueAt: number): string | undefined {
  const { trigger } = automation;

  if (trigger.kind !== AUTOMATION_TRIGGER.SCHEDULE || !scheduleRunsOnce(trigger)) return undefined;
  const instant = onceInstant(trigger);

  return instant !== undefined && instant.getTime() <= dueAt ? trigger.at : undefined;
}

/**
 * One delivery acted on: the firing it carries recorded under its dedupe
 * key, a schedule's next instant written for the list to show, the run
 * started where it is still queued, and a one-time automation paused once
 * its schedule's run is; nothing for an automation gone. Note that the pause
 * comes after the run is acted on, because a run finds its automation
 * paused and is skipped (`automation-runs.ts`).
 */
export const consumeAutomationRunMessage = /* @__PURE__ */ Effect.fn(
  "web/consumeAutomationRunMessage",
)(function* (
  sessionsFor: SessionsForAccount,
  message: WireValue,
): Effect.fn.Return<void, unknown, StartServices> {
  const now = yield* Clock.currentTimeMillis;
  const delivered = yield* Effect.option(decodeDelivered(message));

  if (Option.isNone(delivered)) {
    return yield* Effect.logError("an automation-runs message did not decode; it is dropped");
  }

  const firing =
    "executionId" in delivered.value ? scheduledFiring(delivered.value, now) : delivered.value;

  const automation = yield* recordFiring(firing);

  if (Option.isNone(automation)) return;
  const { trigger } = automation.value;

  if (
    firing.firing.kind === AUTOMATION_FIRING.SCHEDULE &&
    trigger.kind === AUTOMATION_TRIGGER.SCHEDULE
  ) {
    yield* advanceAutomationSchedule(
      firing.automationId,
      nextScheduledRun(trigger, new Date(now)) ?? null,
    );
  }

  const run = yield* automationRunToAct(firing.automationId, firing.dedupeKey);

  if (Option.isSome(run) && run.value.status === AUTOMATION_RUN_STATUS.QUEUED) {
    yield* actOnAutomationRun(sessionsFor, run.value);
  }

  // Note that the pause holds to the date and time that fired, so a date moved on beside this delivery is left to run.
  const spent =
    firing.firing.kind === AUTOMATION_FIRING.SCHEDULE
      ? spentAt(automation.value, firing.firing.dueAt)
      : undefined;

  if (spent !== undefined) yield* pauseSpentAutomation(firing.automationId, spent);
});

/**
 * The consumer's route handler over the services the function's runtime
 * handed it: each delivery acknowledged once acted on, and a failure logged
 * and left for the queue to deliver again.
 */
export function automationRunsHandler(
  services: Context.Context<StartServices>,
): (request: Request) => Promise<Response> {
  return queueConsumer(services, (message) =>
    consumeAutomationRunMessage(routedSessions, message).pipe(
      Effect.as(QUEUE_ACKNOWLEDGED),
      Effect.tapCause((cause) =>
        Effect.logWarning(`an automation run's delivery will come again: ${failureKind(cause)}`),
      ),
    ),
  );
}

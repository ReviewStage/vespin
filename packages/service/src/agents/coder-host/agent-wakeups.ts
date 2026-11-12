/**
 * agent-wakeups.ts -- a coding agent's booked wakeup published as a queue message delayed until it comes due, and that message's consumer, which hands the prompt back to the agent.
 *
 * A booking (`wakeup-tool.ts`) writes the agent's one wakeup row and
 * publishes a message naming that row, delayed by the booking's delay, under
 * the row's id, so a publish sent twice is dropped as the first's. The
 * consumer (`consumeAgentWakeup`) reads the row just before it sends, so a
 * wakeup canceled, booked over, or of an archived agent since sends nothing,
 * and hands the prompt to the agent as a line sent by the agent itself,
 * since the words are its own, the one way a line reaches an agent
 * (`steerAgent`), which opens its next turn in the session it resumes; the
 * line is marked the app's (`APP_LINE_METADATA`), which the transcript draws
 * as the agent waking up. The line goes under a key of the wakeup's own, so a
 * delivery repeated after one that landed is told once, and the row is
 * deleted once it has. A delivery that fails comes again after
 * `AGENT_WAKEUP.FAILED_AGAIN`, until the message's retention, its due time
 * and `AGENT_WAKEUP.RETAINED_PAST_DUE`, has passed.
 *
 * The queue is Vercel Queues on production and on a Preview. Anywhere else,
 * as the local server, there is no queue: each message is handed in this
 * process to the same consumer, on a fiber of its own that sleeps out the
 * delay on the clock, over the publisher's services, and delivered again
 * after a failure as the queue would.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { readAgent } from "@repo/database/models/agent-store";
import { deleteAgentWakeup, standingAgentWakeup } from "@repo/database/models/agent-wakeups";
import { APP_LINE_METADATA, storeWriter } from "@repo/database/models/writer";
import { causeKind, failureKind } from "@repo/runtime/effect";
import type { Sandbox } from "@repo/sandbox";
import { send } from "@vercel/queue";
import {
  Cause,
  Clock,
  Config,
  ConfigProvider,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
} from "effect";
import type { HttpClient } from "effect/http";
import { AUTH_DEPLOYMENT_ENVIRONMENT, DEPLOYMENT_ENVIRONMENT } from "../../auth/auth-deployment.js";
import type { SessionsForAccount } from "../../automations/automation-runs.js";
import type { GitHubApp } from "../../github/github-app.js";
import { QUEUE_ACKNOWLEDGED, queueConsumer } from "../../queues/queue-consumer.js";
import { AGENT_WAKEUP } from "./agent-wakeup-bounds.js";
import { routedSessions } from "./runtime-sessions.js";
import { agentLineSender, steerAgent } from "./steer.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/** What a delivery runs against: the store, and what steering a line to an agent reaches. */
export type AgentWakeupServices = DatabaseServices | HttpClient.HttpClient | GitHubApp | Sandbox;

/** One booked wakeup as it is published: its row, and how long from now it comes due. */
export interface PublishedAgentWakeup {
  readonly wakeupId: string;
  readonly delay: Duration.Duration;
}

/** A booking's message the queue did not take, so its booking is refused. */
export class AgentWakeupNotPublished extends Data.TaggedError("AgentWakeupNotPublished")<{
  readonly reason: string;
}> {}

interface AgentWakeupsShape {
  /** The booking's message published, delayed until it comes due, or why the queue did not take it. */
  readonly publish: (
    wakeup: PublishedAgentWakeup,
  ) => Effect.Effect<void, AgentWakeupNotPublished, AgentWakeupServices>;
}

/** A message as the queue carries it: the row it names, and nothing of the prompt or the agent. */
const WakeupMessageSchema = Schema.Struct({ wakeupId: Schema.String });

/** The key a wakeup's line is sent under, so a delivery repeated is told once. */
function wakeupKey(wakeupId: string): string {
  return `agent-wakeup:${wakeupId}`;
}

/** How long a message is kept: its delay, then `AGENT_WAKEUP.RETAINED_PAST_DUE` of deliveries again. */
function retentionOf(delay: Duration.Duration): Duration.Duration {
  return Duration.sum(delay, AGENT_WAKEUP.RETAINED_PAST_DUE);
}

/**
 * One delivery of the wakeup under the id, as the queue hands its message:
 * nothing where it stands no more, and else its prompt sent to its agent as
 * a line of the agent's own and the row deleted; a failure is the caller's,
 * which leaves the message to come again.
 */
export const consumeAgentWakeup = (sessionsFor: SessionsForAccount, wakeupId: string) =>
  Effect.gen(function* () {
    const standing = yield* standingAgentWakeup(wakeupId);

    if (Option.isNone(standing)) return;
    const { userId, agentId, prompt } = standing.value;
    const agent = yield* readAgent(userId, agentId);

    // An agent gone since is no one's to tell, and its wakeup goes with it.
    if (Option.isNone(agent)) return yield* deleteAgentWakeup(wakeupId);
    yield* steerAgent(
      yield* sessionsFor(userId),
      storeWriter({ tools: CODER_TOOL_SET }),
      userId,
      agent.value,
      {
        text: prompt,
        clientKey: wakeupKey(wakeupId),
        sender: agentLineSender(agent.value),
        metadata: APP_LINE_METADATA,
      },
    );
    yield* deleteAgentWakeup(wakeupId);
  }).pipe(Effect.annotateLogs({ wakeupId }));

/** On Vercel: the message sent to the topic, delayed by the booking's delay and kept past it, under the row's id; a send that failed or stalled refuses the booking. */
const vercelPublish = ({ wakeupId, delay }: PublishedAgentWakeup) =>
  Effect.tryPromise(() =>
    send(
      AGENT_WAKEUP.TOPIC,
      { wakeupId },
      {
        idempotencyKey: wakeupId,
        delaySeconds: Math.ceil(Duration.toSeconds(delay)),
        retentionSeconds: Math.ceil(Duration.toSeconds(retentionOf(delay))),
      },
    ),
  ).pipe(
    Effect.timeoutOption(AGENT_WAKEUP.PUBLISH_WAIT),
    Effect.mapError((failure) => new AgentWakeupNotPublished({ reason: failureKind(failure) })),
    Effect.flatMap((sent) =>
      Option.isSome(sent)
        ? Effect.void
        : Effect.fail(new AgentWakeupNotPublished({ reason: "the publish outlasted its bound" })),
    ),
  );

/**
 * A message's deliveries in this process, as the queue would make them: the
 * delay slept out, then handed to the consumer, and handed again after a
 * failure until its retention has passed.
 */
const deliveredInProcess = ({ wakeupId, delay }: PublishedAgentWakeup) =>
  Effect.gen(function* () {
    const until = (yield* Clock.currentTimeMillis) + Duration.toMillis(retentionOf(delay));
    yield* Effect.sleep(delay);

    while (true) {
      const failed = yield* consumeAgentWakeup(routedSessions, wakeupId).pipe(
        Effect.as(false),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.as(
                Effect.logWarning(`an agent's wakeup will be delivered again: ${causeKind(cause)}`),
                true,
              ),
        ),
      );

      if (!failed) return;
      yield* Effect.sleep(AGENT_WAKEUP.FAILED_AGAIN);

      if ((yield* Clock.currentTimeMillis) >= until) return;
    }
  });

/** Off Vercel: the message delivered in this process, on a fiber of its own over the publisher's services. */
const inProcessPublish = (
  wakeup: PublishedAgentWakeup,
): Effect.Effect<void, never, AgentWakeupServices> =>
  Effect.gen(function* () {
    const services = yield* Effect.context<AgentWakeupServices>();
    yield* Effect.forkDetach(deliveredInProcess(wakeup).pipe(Effect.provideContext(services)));
  });

/** The queue one runtime publishes wakeups to: this process's by default, as a test or a local run has it. */
export const AgentWakeups = Context.Reference<AgentWakeupsShape>("@repo/service/AgentWakeups", {
  defaultValue: () => ({ publish: inProcessPublish }),
});

/** The queue as the deployment's environment names it: Vercel's on production and on a Preview, this process's anywhere else. */
export const agentWakeupsFromEnvironment = Layer.effect(
  AgentWakeups,
  Effect.map(
    Config.option(Config.String(AUTH_DEPLOYMENT_ENVIRONMENT.ENVIRONMENT)),
    (deployment): AgentWakeupsShape => ({
      publish: Option.exists(
        deployment,
        (named) =>
          named === DEPLOYMENT_ENVIRONMENT.PRODUCTION || named === DEPLOYMENT_ENVIRONMENT.PREVIEW,
      )
        ? vercelPublish
        : inProcessPublish,
    }),
  ).pipe(
    Effect.provideServiceEffect(
      ConfigProvider.ConfigProvider,
      Effect.sync(() => ConfigProvider.fromEnv()),
    ),
  ),
);

/**
 * The consumer's route handler over the services the function's runtime
 * handed it: each delivery acknowledged once settled, one that does not
 * decode dropped, and a failure left for the queue to deliver again after
 * `AGENT_WAKEUP.FAILED_AGAIN`.
 */
export function agentWakeupsHandler(
  services: Context.Context<AgentWakeupServices>,
): (request: Request) => Promise<Response> {
  return queueConsumer(
    services,
    (message) =>
      Effect.gen(function* () {
        const decoded = yield* Effect.option(
          Schema.decodeUnknownEffect(WakeupMessageSchema)(message),
        );

        if (Option.isNone(decoded)) {
          yield* Effect.logError("an agent-wakeups message did not decode; it is dropped");

          return QUEUE_ACKNOWLEDGED;
        }

        yield* consumeAgentWakeup(routedSessions, decoded.value.wakeupId).pipe(
          Effect.tapCause((cause) =>
            Effect.logWarning(`an agent's wakeup will be delivered again: ${causeKind(cause)}`),
          ),
        );

        return QUEUE_ACKNOWLEDGED;
      }),
    AGENT_WAKEUP.FAILED_AGAIN,
  );
}

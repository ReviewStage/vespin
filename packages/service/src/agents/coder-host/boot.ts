/**
 * boot.ts -- an agent's first launch: its machine booted with its first message waiting in its queue, the queue handed on once the machine is up, a boot that failed said, and Retry.
 *
 * A Start's first message waits in the agent's queue from the moment its
 * boot begins (`beginAgentBoot`), as every line sent to the agent while it
 * boots does (`steer.ts`'s `heldWhileBooting`), and the machine is booted
 * for it with no message (`AgentSessions`'s `boot`): the plan's credential is read
 * and a session claimed within the request, so a plan refused refuses the
 * Start at once, and the machine opens past the answer, its runner
 * launched warm. Once the runner is up the boot hands its queue on
 * (`bootBecameReady`), which opens the first turn on the first message; a
 * machine that could not come up fails the boot with why and pauses its
 * queue, the messages kept for Retry (`retryBoot`). A boot that never says
 * either way is failed by the minute sweep past its deadline
 * (`reconcile.ts`). A boot held while its workspace's drive is built is
 * booted once the build is done (`builtBootResumed`), as Retry boots one.
 */

import {
  agentBootBuilt,
  agentBootRunnerUp,
  beginAgentBoot,
  failAgentBoot,
  rebootAgent,
} from "@repo/database/models/agent-boot-store";
import type { QueuedLine } from "@repo/database/models/agent-queue-store";
import type { Agent } from "@repo/database/models/agent-store";
import { claimRuntimeSession } from "@repo/database/models/recorded-session";
import { BOOT_FAILURE, type BootFailure } from "@repo/features/agent-boot";
import type { AgentAttachment } from "@repo/features/agent-wire";
import { DateTime, Effect, Option } from "effect";
import { afterResponse } from "../../http/after-response.js";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import { controlsAgent } from "../agent-reach.js";
import {
  type AgentSessions,
  describeUnreachable,
  MACHINE_UP,
  type MachineBoot,
  type MachineUp,
  SESSION_SEND_OUTCOME,
} from "../sessions/agent-sessions.js";
import { agentFailureSaid, agentLogIds } from "./agent-log.js";
import { type QueueSessions, queueAtTouch } from "./agent-queue.js";
import { routedSessions } from "./runtime-sessions.js";

/** The attempt a Start's boot runs under, which `beginAgentBoot` writes; each Retry begins the next. */
const FIRST_ATTEMPT = 1;

/** A Start's first message as it waits in the agent's queue: its key, words, files, and what it names beside them. */
export interface FirstLine {
  readonly id: string;
  readonly sendKey: string;
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
  readonly line: QueuedLine;
}

/** The machine booted through the agent's sessions, a harness not reached answered as nothing booted. */
const booted = (sessions: AgentSessions, agent: Agent): Effect.Effect<MachineBoot | undefined> =>
  sessions.boot(agent.conversationId).pipe(
    Effect.catchTag("SessionUnreachable", (failure) =>
      Effect.as(
        agentFailureSaid(
          `the agent's runtime could not be reached to boot its machine: ${describeUnreachable(failure)}`,
          failure._tag,
          true,
        ),
        undefined,
      ),
    ),
    Effect.annotateLogs(agentLogIds(agent)),
  );

/**
 * The boot's session recorded as the agent's conversation's, forward only,
 * as the harness's own boot claims it, so the queue's hand-off finds it
 * whichever sessions answered the boot.
 */
const claimedFor = (agent: Agent, sessionId: string) =>
  Effect.flatMap(DateTime.nowAsDate, (now) =>
    hostedStoreOrUnavailable(
      claimRuntimeSession(
        { userId: agent.userId, conversationId: agent.conversationId },
        sessionId,
        now,
      ),
    ),
  );

/**
 * The agent's runner up under `attempt`: its boot moved on, and its queue
 * handed on where anything waits in it, which opens the first turn on its
 * head. A runner up for a boot already moved on, for an attempt Retry has
 * since replaced, or for an agent whose first launch is over, moves nothing.
 */
export const bootBecameReady = Effect.fn("web/bootBecameReady")(function* (
  agent: Agent,
  attempt: number,
  sessionsFor: QueueSessions = routedSessions,
) {
  const moved = yield* agentBootRunnerUp(agent.id, yield* DateTime.nowAsDate, attempt);

  if (Option.isNone(moved)) return;
  yield* queueAtTouch(sessionsFor, agent);
});

/** The boot under `attempt` failed for `failure`: its queue paused, its messages kept. */
const bootFailed = (agent: Agent, failure: BootFailure, attempt: number) =>
  Effect.gen(function* () {
    yield* failAgentBoot(agent.id, failure, yield* DateTime.nowAsDate, attempt);
    yield* Effect.logWarning(`an agent's first launch failed to boot: ${failure}`);
  });

/**
 * The machine's open past the answer: the boot failed where it could not
 * come up, its queue handed on where its runner is up, and left as it
 * stands where its host says itself when its runner starts (a Mac's
 * `lineStep`).
 */
const machineCameUp = (
  agent: Agent,
  up: Effect.Effect<BootFailure | MachineUp>,
  attempt: number,
  sessionsFor: QueueSessions,
) =>
  afterResponse(
    "an agent's first launch's machine",
    Effect.gen(function* () {
      const came = yield* up;

      if (came === MACHINE_UP.AWAITS_HOST) return;

      if (came !== MACHINE_UP.READY) return yield* bootFailed(agent, came, attempt);
      yield* bootBecameReady(agent, attempt, sessionsFor);
    }).pipe(Effect.annotateLogs(agentLogIds(agent))),
  );

/**
 * The agent's machine booted under `attempt`, its boot just moved to
 * STARTING: failed at once where the machine could not even be asked for,
 * and else its session claimed and the machine's open left past the answer.
 */
const machineBootedUnder = (agent: Agent, attempt: number, sessionsFor: QueueSessions) =>
  Effect.gen(function* () {
    const boot = yield* booted(yield* sessionsFor(agent.userId), agent);

    if (boot === undefined || boot.outcome !== SESSION_SEND_OUTCOME.ACCEPTED) {
      yield* hostedStoreOrUnavailable(bootFailed(agent, BOOT_FAILURE.MACHINE_UNAVAILABLE, attempt));

      return;
    }

    yield* claimedFor(agent, boot.sessionId);
    yield* machineCameUp(agent, boot.up, attempt, sessionsFor);
  });

/**
 * The agent's first launch begun: its boot written with its first message
 * queued, then its machine booted through the Start's sessions. Answers how
 * the boot's start went, as an open answers, none where its runtime could
 * not be reached, so a Start refused for its plan, its key, or its Mac is
 * refused at once; the machine itself comes up past the answer.
 */
export const startBoot = Effect.fn("web/startBoot")(function* (
  sessions: AgentSessions,
  agent: Agent,
  first: FirstLine,
) {
  // Note that the first attempt begins when the agent was made, so its tab counts Starting… from the one instant its summary and its boot both carry.
  yield* hostedStoreOrUnavailable(
    beginAgentBoot(agent.id, agent.createdAt, { userId: agent.userId, ...first }),
  );
  const boot = yield* booted(sessions, agent);

  if (boot === undefined || boot.outcome !== SESSION_SEND_OUTCOME.ACCEPTED) return boot;
  yield* claimedFor(agent, boot.sessionId);
  // Note that the first message goes through the very sessions that booted its machine.
  yield* machineCameUp(agent, boot.up, FIRST_ATTEMPT, () => Effect.succeed(sessions));

  return { outcome: boot.outcome, sessionId: boot.sessionId } as const;
});

/**
 * A failed first launch booted again by a member who controls the agent:
 * its queue's boot pause lifted and a machine of its own opened, past any
 * the failed boot left. Refused as invalid where its boot is not failed,
 * and failed again at once where the machine could not even be asked for.
 * Every move it makes names the reboot's attempt, so a stale earlier boot
 * can neither release nor fail this one.
 */
export const retryBoot = Effect.fn("web/retryBoot")(function* (userId: string, agent: Agent) {
  if (!controlsAgent(userId, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);

  const rebooted = yield* hostedStoreOrUnavailable(
    rebootAgent(agent.id, yield* DateTime.nowAsDate),
  );

  if (Option.isNone(rebooted)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  yield* machineBootedUnder(agent, rebooted.value.attempt, routedSessions);
});

/**
 * A boot that waited on its workspace's drive moved on once the build is
 * done (`agentBootBuilt`), and its machine booted as Retry boots one, under
 * the attempt the boot was building under. Nothing where the boot no longer
 * stands building under it: the sweep failed it meanwhile, or another
 * delivery already moved it. The machine opens from a fork of the drive
 * where the drive now holds its repository, and from the image with a clone
 * where it does not, as any open does.
 */
export const builtBootResumed = Effect.fn("web/builtBootResumed")(function* (
  agent: Agent,
  attempt: number,
  sessionsFor: QueueSessions = routedSessions,
) {
  const moved = yield* hostedStoreOrUnavailable(
    agentBootBuilt(agent.id, yield* DateTime.nowAsDate, attempt),
  );

  if (Option.isNone(moved)) return;
  yield* machineBootedUnder(agent, attempt, sessionsFor);
});

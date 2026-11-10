/**
 * boot.ts -- an agent's first launch: its machine booted with its first message waiting in its queue, the queue handed on once the machine is up, a boot that failed said, and Retry.
 *
 * A Start's first message waits in the agent's queue from the moment its
 * boot begins (`beginAgentBoot`), as every line sent to the agent while it
 * boots does (`steer.ts`'s `heldWhileBooting`), and the machine is booted
 * for it with no message (`machineBooted`): the plan's credential is read
 * and a session claimed within the request, so a plan refused refuses the
 * Start at once, and the machine opens past the answer, its runner
 * launched warm. Once the runner is up the boot hands its queue on
 * (`bootBecameReady`), which opens the first turn on the first message; a
 * machine that could not come up fails the boot with why and pauses its
 * queue, the messages kept for Retry (`retryBoot`). A boot that never says
 * either way is failed by the minute sweep past its deadline
 * (`reconcile.ts`). Both the cloud and a Mac boot this way.
 */

import {
  agentBootRunnerUp,
  beginAgentBoot,
  failAgentBoot,
  rebootAgent,
} from "@repo/database/models/agent-boot-store";
import type { QueuedLine } from "@repo/database/models/agent-queue-store";
import type { Agent } from "@repo/database/models/agent-store";
import { BOOT_FAILURE, type BootFailure } from "@repo/features/agent-boot";
import type { AgentAttachment } from "@repo/features/agent-wire";
import { DateTime, Effect, Option } from "effect";
import { afterResponse } from "../../http/after-response.js";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import { controlsAgent } from "../agent-reach.js";
import { SESSION_SEND_OUTCOME } from "../sessions/agent-sessions.js";
import { agentLogIds } from "./agent-log.js";
import { queueAtTouch } from "./agent-queue.js";
import { machineBooted, routedSessions } from "./runtime-sessions.js";

/** A Start's first message as it waits in the agent's queue: its key, words, files, and what it names beside them. */
export interface FirstLine {
  readonly id: string;
  readonly sendKey: string;
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
  readonly line: QueuedLine;
}

/**
 * The agent's runner up: its boot moved on, and its queue handed on where
 * anything waits in it, which opens the first turn on its head. A runner
 * up for a boot already moved on, or for an agent whose first launch is
 * over, moves nothing.
 */
export const bootBecameReady = Effect.fn("web/bootBecameReady")(function* (agent: Agent) {
  const moved = yield* agentBootRunnerUp(agent.id, yield* DateTime.nowAsDate, undefined);
  if (Option.isNone(moved)) return;
  yield* queueAtTouch(routedSessions, agent);
});

/** The boot under `attempt` failed for `failure`: its queue paused, its messages kept. */
const bootFailed = (agent: Agent, failure: BootFailure, attempt: number | undefined) =>
  Effect.gen(function* () {
    yield* failAgentBoot(agent.id, failure, yield* DateTime.nowAsDate, attempt);
    yield* Effect.logWarning(`an agent's first launch failed to boot: ${failure}`);
  });

/** The machine's open past the answer: the boot failed where it could not come up, its queue handed on where it did. */
const machineCameUp = (
  agent: Agent,
  up: Effect.Effect<BootFailure | undefined>,
  attempt: number | undefined,
) =>
  afterResponse(
    "an agent's first launch's machine",
    Effect.gen(function* () {
      const failure = yield* up;
      if (failure !== undefined) return yield* bootFailed(agent, failure, attempt);
      yield* bootBecameReady(agent);
    }).pipe(Effect.annotateLogs(agentLogIds(agent))),
  );

/**
 * The agent's first launch begun: its boot written with its first message
 * queued, then its machine booted. Answers how the boot's start went, as an
 * open answers, so a Start refused for its plan, its key, or its Mac is
 * refused at once; the machine itself comes up past the answer.
 */
export const startBoot = Effect.fn("web/startBoot")(function* (agent: Agent, first: FirstLine) {
  yield* hostedStoreOrUnavailable(
    beginAgentBoot(agent.id, yield* DateTime.nowAsDate, { userId: agent.userId, ...first }),
  );
  const booted = yield* machineBooted(agent);
  if (booted.outcome !== SESSION_SEND_OUTCOME.ACCEPTED) return booted;
  yield* machineCameUp(agent, booted.up, undefined);
  return { outcome: booted.outcome, sessionId: booted.sessionId } as const;
});

/**
 * A failed first launch booted again by a member who controls the agent:
 * its queue's boot pause lifted and a machine of its own opened, past any
 * the failed boot left. Refused as invalid where its boot is not failed,
 * and failed again at once where the machine could not even be asked for.
 */
export const retryBoot = Effect.fn("web/retryBoot")(function* (userId: string, agent: Agent) {
  if (!controlsAgent(userId, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const rebooted = yield* hostedStoreOrUnavailable(
    rebootAgent(agent.id, yield* DateTime.nowAsDate),
  );
  if (Option.isNone(rebooted)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { attempt } = rebooted.value;
  const booted = yield* machineBooted(agent);
  if (booted.outcome !== SESSION_SEND_OUTCOME.ACCEPTED) {
    yield* hostedStoreOrUnavailable(bootFailed(agent, BOOT_FAILURE.MACHINE_UNAVAILABLE, attempt));
    return;
  }
  yield* machineCameUp(agent, booted.up, attempt);
});
